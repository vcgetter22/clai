import Foundation

/// One line of the ledger: a day, a tool, a model and the price tier its requests were billed at.
public struct BucketKey: Hashable, Sendable {
    public var day: Day
    public var tool: Tool
    public var model: String
    /// Requests over the model's long-context threshold.
    public var long: Bool
    /// Requests in Claude Code's fast mode.
    public var fast: Bool

    public init(day: Day, tool: Tool, model: String, long: Bool = false, fast: Bool = false) {
        self.day = day
        self.tool = tool
        self.model = model
        self.long = long
        self.fast = fast
    }

    var dayTool: DayTool { DayTool(day: day, tool: tool) }
}

struct DayTool: Hashable {
    var day: Day
    var tool: Tool
}

public struct BucketValue: Sendable, Equatable {
    public var tokens: Tokens
    public var requests: Int
    public var webSearches: Int
    /// What the tool itself logged as cost (OpenCode does); used only for models clai has no price for.
    public var loggedCost: Double

    public init(tokens: Tokens = .zero, requests: Int = 0, webSearches: Int = 0, loggedCost: Double = 0) {
        self.tokens = tokens
        self.requests = requests
        self.webSearches = webSearches
        self.loggedCost = loggedCost
    }

    public mutating func add(_ event: UsageEvent) {
        tokens += event.tokens
        requests += 1
        webSearches += event.webSearches
        loggedCost += event.loggedCost ?? 0
    }
}

/// Daily totals per tool and model, kept in `~/Library/Application Support/clai/ledger.json`.
///
/// The logs are the source of truth while they exist. The ledger keeps what they said, so the
/// month and the history survive when a tool deletes old logs (Claude Code removes transcripts
/// after 30 days by default). For each day and tool, the side that counted more requests wins:
/// a fresh count of logs still on disk replaces the stored one, and a day whose logs are gone
/// keeps its stored total.
public struct Ledger: Sendable, Equatable {
    /// Bump when a reader changes what it counts: the next launch recounts every day whose logs
    /// still exist instead of keeping the larger number.
    public static let readersVersion = 1
    static let formatVersion = 1

    public private(set) var buckets: [BucketKey: BucketValue]
    /// The readers version the stored totals were counted with.
    public private(set) var readers: Int

    public init(buckets: [BucketKey: BucketValue] = [:], readers: Int = Ledger.readersVersion) {
        self.buckets = buckets
        self.readers = readers
    }

    /// Adds up events into ledger lines.
    public static func buckets(from events: [UsageEvent], pricer: Pricer, days: inout DayResolver) -> [BucketKey: BucketValue] {
        var out: [BucketKey: BucketValue] = [:]
        for event in events {
            let day = days.day(at: event.time)
            let price = pricer.match(event.model)?.price(on: day)
            let key = BucketKey(
                day: day,
                tool: event.tool,
                model: event.model,
                long: price?.isLong(event.tokens) ?? false,
                fast: event.fast && (price?.fast ?? 1) > 1
            )
            out[key, default: BucketValue()].add(event)
        }
        return out
    }

    /// Takes in a complete count of the logs on disk. Returns whether anything changed.
    @discardableResult
    public mutating func merge(live: [BucketKey: BucketValue]) -> Bool {
        let recount = readers != Ledger.readersVersion
        var liveRequests: [DayTool: Int] = [:]
        for (key, value) in live { liveRequests[key.dayTool, default: 0] += value.requests }
        var storedRequests: [DayTool: Int] = [:]
        for (key, value) in buckets { storedRequests[key.dayTool, default: 0] += value.requests }

        var replace = Set<DayTool>()
        for (dayTool, count) in liveRequests where recount || count >= storedRequests[dayTool, default: 0] {
            replace.insert(dayTool)
        }
        var next = buckets.filter { !replace.contains($0.key.dayTool) }
        for (key, value) in live where replace.contains(key.dayTool) { next[key] = value }
        let changed = next != buckets || recount
        buckets = next
        readers = Ledger.readersVersion
        return changed
    }

    // MARK: Storage

    private struct File: Codable {
        var format: Int
        var readers: Int
        var rows: [Row]
    }

    private struct Row: Codable {
        var d: Day
        var t: String
        var m: String
        var l: Bool?
        var f: Bool?
        var n: Int
        var s: Int?
        var c: Double?
        var k: Tokens
    }

    /// The ledger stored at `url`, or an empty one when there is none or it cannot be read.
    public static func load(from url: URL) -> Ledger {
        guard let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data),
              file.format == formatVersion else { return Ledger() }
        var buckets: [BucketKey: BucketValue] = [:]
        for row in file.rows {
            guard let tool = Tool(rawValue: row.t) else { continue }
            let key = BucketKey(day: row.d, tool: tool, model: row.m, long: row.l ?? false, fast: row.f ?? false)
            buckets[key] = BucketValue(tokens: row.k, requests: row.n, webSearches: row.s ?? 0, loggedCost: row.c ?? 0)
        }
        return Ledger(buckets: buckets, readers: file.readers)
    }

    public func save(to url: URL) throws {
        let rows = buckets
            .sorted { ($0.key.day, $0.key.tool, $0.key.model) < ($1.key.day, $1.key.tool, $1.key.model) }
            .map { key, value in
                Row(d: key.day, t: key.tool.rawValue, m: key.model,
                    l: key.long ? true : nil, f: key.fast ? true : nil,
                    n: value.requests, s: value.webSearches == 0 ? nil : value.webSearches,
                    c: value.loggedCost == 0 ? nil : value.loggedCost, k: value.tokens)
            }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(File(format: Ledger.formatVersion, readers: readers, rows: rows))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}

private func < (lhs: (Day, Tool, String), rhs: (Day, Tool, String)) -> Bool {
    if lhs.0 != rhs.0 { return lhs.0 < rhs.0 }
    if lhs.1 != rhs.1 { return lhs.1 < rhs.1 }
    return lhs.2 < rhs.2
}
