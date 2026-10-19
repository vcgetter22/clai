import Foundation

/// Number formatting shared by every view. `usd` and `tokens` mirror `formatUsd` and
/// `formatTokens` in @claii/core, so the menu bar and the CLI print the same figures.
public enum Format {
    /// `$0.0042`, `$0.042`, `$12.35`, `$1,234`; compact: `$1.2k`, `$12k`.
    public static func usd(_ value: Double?, compact: Bool = false) -> String {
        guard let n = value, !n.isNaN, n.isFinite else { return "-" }
        let magnitude = abs(n)
        if compact && magnitude >= 1000 { return "$" + fixed(n / 1000, magnitude >= 10000 ? 0 : 1) + "k" }
        if magnitude >= 100 { return "$" + grouped(jsRound(n)) }
        if magnitude >= 1 { return "$" + fixed(n, 2) }
        if magnitude >= 0.01 { return "$" + fixed(n, 3) }
        if magnitude == 0 { return "$0" }
        return "$" + fixed(n, 4)
    }

    /// Whole dollars below $10,000 (`$42`, `$1,082`), compact above (`$12k`): for the menu bar.
    public static func usdShort(_ value: Double) -> String {
        if abs(value) >= 10000 { return usd(value, compact: true) }
        if abs(value) >= 100 { return usd(value) }
        if abs(value) >= 10 { return "$" + grouped(jsRound(value)) }
        return usd(value)
    }

    /// Chart axis ticks: whole dollars when the tick is whole (`$0`, `$5`, `$200`), cents only
    /// when a tick needs them (`$2.50`), compact from $1,000 (`$1.5k`).
    public static func axisUsd(_ value: Double) -> String {
        guard !value.isNaN, value.isFinite else { return "-" }
        if abs(value) >= 1000 { return usd(value, compact: true) }
        if value == value.rounded() { return "$" + grouped(Int(value)) }
        return "$" + fixed(value, 2)
    }

    /// `950`, `12.3k`, `123k`, `4.5M`, `123M`, `1.20B`.
    public static func tokens(_ value: Double) -> String {
        if value >= 1e9 { return fixed(value / 1e9, 2) + "B" }
        if value >= 1e6 { return fixed(value / 1e6, value >= 1e8 ? 0 : 1) + "M" }
        if value >= 1e3 { return fixed(value / 1e3, value >= 1e5 ? 0 : 1) + "k" }
        return String(jsRound(value))
    }

    /// `0.256` -> `26%`.
    public static func percent(_ fraction: Double, digits: Int = 0) -> String {
        fixed(fraction * 100, digits) + "%"
    }

    /// `0.12` -> `+12%`, `-0.08` -> `−8%` (typographic minus).
    public static func signedPercent(_ fraction: Double) -> String {
        let rounded = jsRound(fraction * 100)
        if rounded > 0 { return "+\(rounded)%" }
        if rounded < 0 { return "\u{2212}\(abs(rounded))%" }
        return "±0%"
    }

    /// Plan value multiple: `12.3×`.
    public static func multiple(_ value: Double) -> String {
        fixed(value, 1) + "×"
    }

    /// `just now`, `1 min ago`, `12 min ago`, `3 h ago`, `2 d ago`.
    public static func relative(_ date: Date, now: Date = Date()) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 45 { return "just now" }
        let minutes = Int((seconds / 60).rounded())
        if minutes < 60 { return "\(max(1, minutes)) min ago" }
        let hours = Int(seconds / 3600)
        if hours < 24 { return "\(hours) h ago" }
        return "\(Int(seconds / 86400)) d ago"
    }

    private static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    /// `2026-10` -> `October`.
    public static func monthName(_ key: String) -> String {
        let parts = key.split(separator: "-")
        guard parts.count >= 2, let month = Int(parts[1]), (1...12).contains(month) else { return key }
        return monthNames[month - 1]
    }

    /// `2026-10-14` -> `Oct 14`.
    public static func dayLabel(_ day: String) -> String {
        let parts = day.split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let date = Int(parts[2]), (1...12).contains(month) else { return day }
        return "\(monthNames[month - 1].prefix(3)) \(date)"
    }

    /// A `YYYY-MM-DD` day as noon UTC, for charts that plot days on a time axis.
    public static func dayDate(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: components)
    }

    // MARK: - JavaScript-compatible primitives

    /// `Number.prototype.toFixed` for the magnitudes clai prints.
    static func fixed(_ value: Double, _ digits: Int) -> String {
        let text = String(format: "%.\(digits)f", value)
        // Avoid "-0.00" (JavaScript prints "0.00" for small negatives that round to zero).
        if text.hasPrefix("-"), Double(text) == 0 { return String(text.dropFirst()) }
        return text
    }

    /// `Math.round`: halves round up (towards +infinity).
    static func jsRound(_ value: Double) -> Int {
        Int((value + 0.5).rounded(.down))
    }

    /// `1234567` -> `1,234,567` (en-US grouping, independent of the user's locale).
    static func grouped(_ value: Int) -> String {
        let digits = String(abs(value))
        var out = ""
        for (index, character) in digits.enumerated() {
            if index > 0 && (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(character)
        }
        return (value < 0 ? "-" : "") + out
    }
}
