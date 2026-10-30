import Foundation

/// Number formatting for every view, independent of the user's locale settings so figures always
/// read the same: `$1,082`, `$12.35`, `$0.042`, `4.5M tokens`.
public enum Format {
    /// `$0`, `$0.0042`, `$0.042`, `$12.35`, `$1,234`; compact: `$1.2k`, `$12k`.
    public static func usd(_ value: Double, compact: Bool = false) -> String {
        guard value.isFinite, abs(value) < 1e15 else { return "–" }
        let magnitude = abs(value)
        let sign = value < 0 ? "-" : ""
        if compact && magnitude >= 1000 { return sign + "$" + fixed(magnitude / 1000, magnitude >= 10_000 ? 0 : 1) + "k" }
        if magnitude >= 100 { return sign + "$" + grouped(Int(magnitude.rounded())) }
        if magnitude >= 1 { return sign + "$" + fixed(magnitude, 2) }
        if magnitude >= 0.01 { return sign + "$" + fixed(magnitude, 3) }
        if magnitude < 0.00005 { return "$0" }
        return sign + "$" + fixed(magnitude, 4)
    }

    /// A total that leaves out requests without a price: `–` rather than `$0` when that is all there is.
    public static func usd(_ value: Double, unpriced: Int, compact: Bool = false) -> String {
        unpriced > 0 && abs(value) < 0.00005 ? "–" : usd(value, compact: compact)
    }

    /// The menu bar form of `usd(_:unpriced:)`.
    public static func usdShort(_ value: Double, unpriced: Int) -> String {
        unpriced > 0 && abs(value) < 0.005 ? "–" : usdShort(value)
    }

    /// For the menu bar: whole dollars from $10 (`$42`, `$1,082`), compact from $10,000 (`$12k`),
    /// cents below $10 (`$4.20`).
    public static func usdShort(_ value: Double) -> String {
        guard value.isFinite, abs(value) < 1e15 else { return "–" }
        let magnitude = abs(value)
        if magnitude >= 10_000 { return usd(value, compact: true) }
        if magnitude >= 10 { return (value < 0 ? "-" : "") + "$" + grouped(Int(magnitude.rounded())) }
        if magnitude < 0.005 { return "$0" }
        return (value < 0 ? "-" : "") + "$" + fixed(magnitude, 2)
    }

    /// `950`, `12.3k`, `123k`, `4.5M`, `123M`, `1.20B`.
    public static func tokens(_ value: Int64) -> String {
        let v = Double(value)
        if v >= 1e9 { return fixed(v / 1e9, 2) + "B" }
        if v >= 1e6 { return fixed(v / 1e6, v >= 1e8 ? 0 : 1) + "M" }
        if v >= 1e3 { return fixed(v / 1e3, v >= 1e5 ? 0 : 1) + "k" }
        return String(value)
    }

    /// `1,234`
    public static func count(_ value: Int) -> String { grouped(value) }

    /// `1 request`, `1,234 requests`
    public static func count(_ value: Int, _ singular: String, _ plural: String? = nil) -> String {
        grouped(value) + " " + (value == 1 ? singular : plural ?? singular + "s")
    }

    /// `12.3×`
    public static func multiple(_ value: Double) -> String {
        guard value.isFinite, abs(value) < 1e15 else { return "–" }
        return (value >= 100 ? grouped(Int(value.rounded())) : fixed(value, 1)) + "×"
    }

    /// `just now`, `1 min ago`, `12 min ago`, `3 h ago`, `2 d ago`.
    public static func relative(_ date: Date, now: Date = Date()) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 45 { return "just now" }
        let minutes = Int((seconds / 60).rounded())
        if minutes < 60 { return "\(max(1, minutes)) min ago" }
        let hours = Int(seconds / 3600)
        if hours < 24 { return "\(hours) h ago" }
        return "\(Int(seconds / 86_400)) d ago"
    }

    /// When a limit window resets: `15:40` or `3:40 PM` today, `Tue 15:40` this week, `Nov 4` later.
    public static func resetTime(_ date: Date, now: Date = Date(), locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let template: String
        if calendar.isDate(date, inSameDayAs: now) {
            template = "jmm"
        } else if date > now, date.timeIntervalSince(now) < 6 * 86_400 {
            template = "EEEjmm"
        } else {
            template = "MMMd"
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateFormat = DateFormatter.dateFormat(fromTemplate: template, options: 0, locale: locale) ?? "HH:mm"
        return formatter.string(from: date)
    }

    static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    /// `October`
    public static func monthName(_ day: Day) -> String { monthNames[max(0, min(11, day.month - 1))] }

    /// `Oct 14`
    public static func shortDay(_ day: Day) -> String { "\(monthNames[max(0, min(11, day.month - 1))].prefix(3)) \(day.day)" }

    /// Rounds half away from zero (`printf` alone rounds 12.5 to 12).
    static func fixed(_ value: Double, _ digits: Int) -> String {
        let scale = pow(10, Double(digits))
        let rounded = (value * scale).rounded(.toNearestOrAwayFromZero) / scale
        let text = String(format: "%.\(digits)f", rounded)
        if text.hasPrefix("-"), Double(text) == 0 { return String(text.dropFirst()) }
        return text
    }

    /// `1234567` -> `1,234,567`
    static func grouped(_ value: Int) -> String {
        let digits = String(value.magnitude)
        var out = ""
        for (index, character) in digits.enumerated() {
            if index > 0 && (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(character)
        }
        return (value < 0 ? "-" : "") + out
    }
}
