import Foundation

/// Calendar arithmetic without `Calendar`: fast enough to run once per log line.
/// Algorithms from Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms".
enum CivilDate {
    /// Days since 1970-01-01 for a proleptic Gregorian date.
    static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// The date of a day count since 1970-01-01.
    static func civilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d)
    }
}

/// ISO 8601 timestamps as the tools write them: `2026-10-30T12:34:56.789Z`, with or without
/// fractional seconds, with `Z` or a `+02:00` offset.
public enum Timestamp {
    /// Seconds since 1970, or nil when the text is not a timestamp of that shape.
    public static func parse(_ text: String) -> Double? {
        var copy = text
        return copy.withUTF8 { parse(UnsafeRawBufferPointer($0)) }
    }

    static func parse(_ b: UnsafeRawBufferPointer) -> Double? {
        let n = b.count
        guard n >= 19 else { return nil }
        func digit(_ i: Int) -> Int? {
            let c = b[i]
            return c >= 48 && c <= 57 ? Int(c) - 48 : nil
        }
        func number(_ from: Int, _ count: Int) -> Int? {
            var value = 0
            for i in from..<(from + count) {
                guard let d = digit(i) else { return nil }
                value = value * 10 + d
            }
            return value
        }
        guard b[4] == 45, b[7] == 45, b[10] == 84 || b[10] == 116 || b[10] == 32, b[13] == 58, b[16] == 58,
              let year = number(0, 4), let month = number(5, 2), let day = number(8, 2),
              let hour = number(11, 2), let minute = number(14, 2), let second = number(17, 2),
              (1...12).contains(month), (1...31).contains(day), hour <= 24, minute <= 59, second <= 60
        else { return nil }
        var i = 19
        var fraction = 0.0
        if i < n, b[i] == 46 || b[i] == 44 {
            i += 1
            var scale = 0.1
            while i < n, let d = digit(i) {
                fraction += Double(d) * scale
                scale /= 10
                i += 1
            }
        }
        var offset = 0
        if i < n {
            let c = b[i]
            if c == 43 || c == 45 {
                // +HH:MM, +HHMM or +HH
                let sign = c == 43 ? 1 : -1
                guard i + 3 <= n, let hh = number(i + 1, 2) else { return nil }
                var mm = 0
                if i + 6 <= n, b[i + 3] == 58, let m = number(i + 4, 2) {
                    mm = m
                } else if i + 5 <= n, let m = number(i + 3, 2) {
                    mm = m
                }
                offset = sign * (hh * 3600 + mm * 60)
            }
        }
        guard (1970...2200).contains(year) else { return nil }
        let days = CivilDate.daysFromCivil(year: year, month: month, day: day)
        let seconds = days * 86_400 + hour * 3600 + minute * 60 + second - offset
        return Double(seconds) + fraction
    }

    /// Unix time in seconds, milliseconds or microseconds, as some tools write it; nil outside the
    /// years 2000 to 2100.
    public static func fromEpoch(_ value: Double) -> Double? {
        guard value.isFinite, value > 0 else { return nil }
        var seconds = value
        if value > 1e14 { seconds = value / 1_000_000 } else if value > 1e11 { seconds = value / 1000 }
        return (946_684_800...4_102_444_800).contains(seconds) ? seconds : nil
    }
}

/// Maps instants to calendar days in one time zone, caching the zone's offset per quarter hour
/// (every offset in use is a multiple of 15 minutes, and so is every change of offset).
public struct DayResolver {
    public let timeZone: TimeZone
    private var offsets: [Int: Int] = [:]

    public init(timeZone: TimeZone) {
        self.timeZone = timeZone
    }

    public mutating func day(at time: Double) -> Day {
        let quarter = Int((time / 900).rounded(.down))
        let offset: Int
        if let cached = offsets[quarter] {
            offset = cached
        } else {
            offset = timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: Double(quarter) * 900))
            if offsets.count > 50_000 { offsets.removeAll(keepingCapacity: true) }
            offsets[quarter] = offset
        }
        let local = Int((time + Double(offset)).rounded(.down))
        let days = local >= 0 ? local / 86_400 : (local - 86_399) / 86_400
        return Day(ordinal: days)
    }

    /// The instant a day starts in this time zone.
    public func start(of day: Day) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = DateComponents(year: day.year, month: day.month, day: day.day)
        return calendar.date(from: components) ?? Date(timeIntervalSince1970: Double(day.ordinal) * 86_400)
    }
}
