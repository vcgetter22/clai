import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// One reading of Claude's weekly limit, as `clai --status-line` saw it: how much of the week was
/// used, and when the week resets (which tells the weeks apart).
public struct LimitReading: Codable, Equatable, Sendable {
    public var time: Double
    /// Percent of the weekly limit, 0 to 100 (more when usage credits are on).
    public var weekUsed: Double
    /// When this week resets, seconds since 1970.
    public var weekResets: Double

    public init(time: Double, weekUsed: Double, weekResets: Double) {
        self.time = time
        self.weekUsed = weekUsed
        self.weekResets = weekResets
    }

    enum CodingKeys: String, CodingKey {
        case time = "t", weekUsed = "w", weekResets = "r"
    }
}

/// `claude-limits-history.jsonl`: a line each time the weekly limit moved. The status line command
/// appends; the app reads and trims to the last 60 days.
public enum LimitHistory {
    static let kept: Double = 60 * 86_400

    /// Adds a reading (one short write with `O_APPEND`, so readings of several Claude Code
    /// sessions never mix within a line).
    public static func append(_ reading: LimitReading, to url: URL) {
        guard var data = try? JSONEncoder().encode(reading) else { return }
        data.append(0x0A)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let fd = open(url.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        guard fd >= 0 else { return }
        defer { close(fd) }
        _ = data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
    }

    /// The readings since `since`, oldest first; broken lines are skipped.
    public static func load(from url: URL, since: Double = 0) -> [LimitReading] {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        let decoder = JSONDecoder()
        return text.split(separator: "\n").compactMap { line -> LimitReading? in
            guard let reading = try? decoder.decode(LimitReading.self, from: Data(line.utf8)),
                  reading.time >= since, reading.time.isFinite, reading.weekUsed.isFinite, reading.weekResets.isFinite else { return nil }
            return reading
        }
        .sorted { $0.time < $1.time }
    }

    /// Drops readings older than 60 days, when there are any.
    public static func trim(_ url: URL, now: Double) {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        let all = text.split(separator: "\n")
        let keep = load(from: url, since: now - kept)
        guard keep.count < all.count else { return }
        let encoder = JSONEncoder()
        var data = Data()
        for reading in keep {
            guard let line = try? encoder.encode(reading) else { continue }
            data.append(line)
            data.append(0x0A)
        }
        try? data.write(to: url, options: .atomic)
    }
}

/// What all Claude use on a Pro or Max plan is worth at API list prices, estimated from the weekly
/// limit: claude.ai, the apps and cloud sessions have no usage log or report, but they fill the
/// same weekly limit as Claude Code on this Mac, whose cost clai knows exactly.
///
/// The ruler is the user's own use: over short stretches of Claude Code in Terminal, the dollars
/// this Mac's logs add up to, divided by how far the weekly limit moved, give the dollars per
/// percentage point of the week. Other use in the same stretch only moves the limit further and
/// lowers the ratio, so the rate is taken from the upper part of the ratios (their 75th
/// percentile): it rests on the stretches with the least other use. Then the week's percent times
/// the rate is all of the week's use, and what goes beyond this Mac's logs is the estimate.
///
/// It is an estimate: Anthropic does not publish what a percent of a plan is worth, and the limit
/// may weigh tokens differently from API prices (and claude.ai differently from Claude Code). It is
/// shown as such and never added to the exact figures.
public struct ClaudeEstimate: Equatable, Sendable {
    /// API list dollars per percentage point of the weekly limit; nil while there is too little
    /// local use to measure it.
    public var dollarsPerPoint: Double?
    /// How much of the weekly limit the measurement rests on, in stretches and percentage points.
    public var stretches: Int
    public var points: Double

    /// The current week, from its last reading.
    public var week: Week?
    /// Use beyond this Mac's logs, at the readings where it showed: for days and the month.
    public var beyond: [Moment]
    /// Totals of `beyond`, worked out for the summary's days.
    public var todayBeyond: Double = 0
    public var monthBeyond: Double = 0

    public struct Week: Equatable, Sendable {
        public var used: Double
        public var resets: Double
        /// All Claude use this week so far, at API list prices: what this Mac's logs hold and the
        /// estimate beyond them (at least the week's percent times the rate).
        public var total: Double
        /// What this Mac's logs hold of it.
        public var local: Double
        public var beyond: Double
    }

    public struct Moment: Equatable, Sendable {
        public var time: Double
        public var dollars: Double
    }

    public var isReady: Bool { dollarsPerPoint != nil }

    public init(dollarsPerPoint: Double?, stretches: Int, points: Double, week: Week? = nil, beyond: [Moment] = []) {
        self.dollarsPerPoint = dollarsPerPoint
        self.stretches = stretches
        self.points = points
        self.week = week
        self.beyond = beyond
    }

    /// The totals of the use beyond this Mac for today and this month, in `days`' time zone.
    public func withDays(now: Double, days: inout DayResolver) -> ClaudeEstimate {
        var out = self
        let today = days.day(at: now)
        out.todayBeyond = 0
        out.monthBeyond = 0
        for moment in beyond {
            let day = days.day(at: moment.time)
            if day == today { out.todayBeyond += moment.dollars }
            if day.isSameMonth(as: today) && day <= today { out.monthBeyond += moment.dollars }
        }
        return out
    }
}

public enum ClaudeEstimator {
    static let week: Double = 7 * 86_400
    /// Limits change (Anthropic has changed them several times in 2026): the rate rests on the last four weeks.
    static let calibrationAge: Double = 28 * 86_400
    /// Stretches longer than this are mostly time away from Claude Code; they say little about the rate.
    static let longestStretch: Double = 3 * 3600

    /// This Mac's Claude use (Claude Code and Cowork), at API list prices, by the second.
    public struct Local: Sendable {
        let times: [Double]
        /// `sums[i]`: the cost of the first `i` requests.
        let sums: [Double]

        public init(_ requests: [(time: Double, cost: Double)]) {
            let sorted = requests.filter { $0.cost.isFinite && $0.cost >= 0 }.sorted { $0.time < $1.time }
            times = sorted.map(\.time)
            var running = 0.0
            var sums = [0.0]
            sums.reserveCapacity(sorted.count + 1)
            for request in sorted {
                running += request.cost
                sums.append(running)
            }
            self.sums = sums
        }

        /// The cost of the requests after `start`, up to and including `end`.
        public func cost(after start: Double, upTo end: Double) -> Double {
            guard end > start else { return 0 }
            return sums[count(upTo: end)] - sums[count(upTo: start)]
        }

        /// How many requests are at or before `time`.
        private func count(upTo time: Double) -> Int {
            var low = 0, high = times.count
            while low < high {
                let mid = (low + high) / 2
                if times[mid] <= time { low = mid + 1 } else { high = mid }
            }
            return low
        }
    }

    /// The estimate from the readings and this Mac's use; nil without readings. Readings before
    /// `since` (where this Mac's logs may be gone) are left out.
    public static func estimate(readings all: [LimitReading], local: Local, since: Double, now: Double) -> ClaudeEstimate? {
        let readings = all.filter {
            $0.time >= since && $0.time <= now + 60 && $0.weekUsed >= 0 && $0.weekUsed <= 1_000
                && $0.weekResets > $0.time - 3600 && $0.weekResets <= $0.time + week + 3600
        }.sorted { $0.time < $1.time }
        guard !readings.isEmpty else { return nil }

        // One group per week, told apart by when it resets.
        var weeks: [Int: [LimitReading]] = [:]
        for reading in readings { weeks[Int((reading.weekResets / 60).rounded()), default: []].append(reading) }

        // Whole percents move in steps too coarse for short stretches: ask for longer ones then.
        let fractional = readings.contains { $0.weekUsed != $0.weekUsed.rounded() }
        let step = fractional ? 2.0 : 5.0

        // The ratios of short stretches with local use.
        var ratios: [Double] = []
        var points = 0.0
        for group in weeks.values {
            var anchor = group[0]
            for reading in group.dropFirst() {
                let moved = reading.weekUsed - anchor.weekUsed
                if moved < 0 {
                    anchor = reading
                    continue
                }
                guard moved >= step else { continue }
                let length = reading.time - anchor.time
                let dollars = local.cost(after: anchor.time, upTo: reading.time)
                if length <= longestStretch, reading.time >= now - calibrationAge, dollars >= 0.01 {
                    ratios.append(dollars / moved)
                    points += moved
                }
                anchor = reading
            }
        }
        guard ratios.count >= 3, points >= 3 * step else {
            return ClaudeEstimate(dollarsPerPoint: nil, stretches: ratios.count, points: points)
        }
        ratios.sort()
        let rate = min(max(ratios[Int((Double(ratios.count - 1) * 0.75).rounded())], 0.01), 10_000)

        // Per week: all use so far is percent × rate; the part beyond this Mac's logs grows, never
        // shrinks (a reading a little low, or local use the limit has not counted yet, would
        // otherwise take back what was shown).
        var beyond: [ClaudeEstimate.Moment] = []
        var current: ClaudeEstimate.Week?
        let latest = readings[readings.count - 1]
        for group in weeks.values {
            let resets = group[0].weekResets
            let start = resets - week
            guard start >= since - 3600 else { continue }
            var shown = 0.0
            var last: (reading: LimitReading, local: Double)?
            for reading in group {
                let mine = local.cost(after: start, upTo: reading.time)
                let other = max(shown, reading.weekUsed * rate - mine)
                if other > shown {
                    beyond.append(ClaudeEstimate.Moment(time: reading.time, dollars: other - shown))
                    shown = other
                }
                last = (reading, mine)
            }
            if let last, last.reading == latest, resets > now {
                current = ClaudeEstimate.Week(used: last.reading.weekUsed, resets: resets, total: last.local + shown,
                                              local: last.local, beyond: shown)
            }
        }
        beyond.sort { $0.time < $1.time }
        return ClaudeEstimate(dollarsPerPoint: rate, stretches: ratios.count, points: points, week: current, beyond: beyond)
    }
}
