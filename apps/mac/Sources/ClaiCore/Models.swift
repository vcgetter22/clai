import Foundation

/// Who makes the models a tool uses. Plan value compares a vendor's subscription with the
/// API-priced value of that vendor's tools.
public enum Vendor: String, Codable, Sendable, CaseIterable {
    case anthropic
    case openai
    case google
    case other
}

/// The AI tools whose local logs clai reads. Raw values are stored in the ledger file, so they
/// never change.
public enum Tool: String, Codable, Sendable, CaseIterable, Comparable {
    case claudeCode = "claude-code"
    case cowork = "claude-cowork"
    case codex = "codex"
    case gemini = "gemini-cli"
    case qwen = "qwen-code"
    case opencode = "opencode"

    public var name: String {
        switch self {
        case .claudeCode: return "Claude Code"
        case .cowork: return "Claude Cowork"
        case .codex: return "Codex"
        case .gemini: return "Gemini CLI"
        case .qwen: return "Qwen Code"
        case .opencode: return "OpenCode"
        }
    }

    /// The vendor whose plan pays for this tool's usage, when there is one.
    public var vendor: Vendor {
        switch self {
        case .claudeCode, .cowork: return .anthropic
        case .codex: return .openai
        case .gemini: return .google
        case .qwen, .opencode: return .other
        }
    }

    public static func < (lhs: Tool, rhs: Tool) -> Bool {
        allCases.firstIndex(of: lhs)! < allCases.firstIndex(of: rhs)!
    }
}

/// Token counts of one request or a sum of requests.
///
/// The convention, whatever the tool logs: `input` is uncached input only (OpenAI and Google
/// report input including cached tokens, so readers subtract them), `output` includes reasoning
/// or thinking tokens, `cacheWrite` is a 5-minute (or unspecified) prompt-cache write and
/// `cacheWrite1h` a 1-hour one (Anthropic only).
public struct Tokens: Codable, Hashable, Sendable {
    public var input: Int64
    public var output: Int64
    public var cacheRead: Int64
    public var cacheWrite: Int64
    public var cacheWrite1h: Int64

    /// No request has a trillion tokens; a larger count is a corrupt log line, and capping it keeps
    /// sums far from overflowing.
    static let ceiling: Int64 = 1_000_000_000_000

    public init(input: Int64 = 0, output: Int64 = 0, cacheRead: Int64 = 0, cacheWrite: Int64 = 0, cacheWrite1h: Int64 = 0) {
        self.input = min(max(0, input), Tokens.ceiling)
        self.output = min(max(0, output), Tokens.ceiling)
        self.cacheRead = min(max(0, cacheRead), Tokens.ceiling)
        self.cacheWrite = min(max(0, cacheWrite), Tokens.ceiling)
        self.cacheWrite1h = min(max(0, cacheWrite1h), Tokens.ceiling)
    }

    public static let zero = Tokens()

    /// Every token of the request, cached or not.
    public var total: Int64 { input + output + cacheRead + cacheWrite + cacheWrite1h }

    /// The whole prompt: what long-context price tiers are measured against.
    public var prompt: Int64 { input + cacheRead + cacheWrite + cacheWrite1h }

    public var isZero: Bool { total == 0 }

    public static func + (lhs: Tokens, rhs: Tokens) -> Tokens {
        var sum = lhs
        sum.input = lhs.input.addingReportingOverflow(rhs.input).overflow ? .max : lhs.input + rhs.input
        sum.output = lhs.output.addingReportingOverflow(rhs.output).overflow ? .max : lhs.output + rhs.output
        sum.cacheRead = lhs.cacheRead.addingReportingOverflow(rhs.cacheRead).overflow ? .max : lhs.cacheRead + rhs.cacheRead
        sum.cacheWrite = lhs.cacheWrite.addingReportingOverflow(rhs.cacheWrite).overflow ? .max : lhs.cacheWrite + rhs.cacheWrite
        sum.cacheWrite1h = lhs.cacheWrite1h.addingReportingOverflow(rhs.cacheWrite1h).overflow ? .max : lhs.cacheWrite1h + rhs.cacheWrite1h
        return sum
    }

    public static func += (lhs: inout Tokens, rhs: Tokens) { lhs = lhs + rhs }

    /// Field by field maximum: repeated log lines of one request only ever grow.
    public func merged(with other: Tokens) -> Tokens {
        Tokens(
            input: max(input, other.input),
            output: max(output, other.output),
            cacheRead: max(cacheRead, other.cacheRead),
            cacheWrite: max(cacheWrite, other.cacheWrite),
            cacheWrite1h: max(cacheWrite1h, other.cacheWrite1h)
        )
    }

    enum CodingKeys: String, CodingKey {
        case input = "i", output = "o", cacheRead = "r", cacheWrite = "w", cacheWrite1h = "h"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            input: try c.decodeIfPresent(Int64.self, forKey: .input) ?? 0,
            output: try c.decodeIfPresent(Int64.self, forKey: .output) ?? 0,
            cacheRead: try c.decodeIfPresent(Int64.self, forKey: .cacheRead) ?? 0,
            cacheWrite: try c.decodeIfPresent(Int64.self, forKey: .cacheWrite) ?? 0,
            cacheWrite1h: try c.decodeIfPresent(Int64.self, forKey: .cacheWrite1h) ?? 0
        )
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if input != 0 { try c.encode(input, forKey: .input) }
        if output != 0 { try c.encode(output, forKey: .output) }
        if cacheRead != 0 { try c.encode(cacheRead, forKey: .cacheRead) }
        if cacheWrite != 0 { try c.encode(cacheWrite, forKey: .cacheWrite) }
        if cacheWrite1h != 0 { try c.encode(cacheWrite1h, forKey: .cacheWrite1h) }
    }
}

/// One model request, read from a tool's log and deduplicated.
public struct UsageEvent: Sendable, Equatable {
    public var tool: Tool
    /// The model id as the tool logged it.
    public var model: String
    /// Seconds since 1970 (UTC).
    public var time: Double
    public var tokens: Tokens
    /// Server-side web searches (Anthropic bills them per 1,000).
    public var webSearches: Int
    /// Claude Code's fast mode, billed at a multiple of the standard price.
    public var fast: Bool
    /// The cost the tool logged itself, when it logs one (OpenCode). clai prices tokens with its
    /// own list and uses this only for models it has no price for.
    public var loggedCost: Double?

    public init(tool: Tool, model: String, time: Double, tokens: Tokens, webSearches: Int = 0, fast: Bool = false, loggedCost: Double? = nil) {
        self.tool = tool
        self.model = model
        self.time = time
        self.tokens = tokens
        self.webSearches = webSearches
        self.fast = fast
        self.loggedCost = loggedCost
    }

    /// Two log lines of the same request: the larger value of every field wins.
    public func merged(with other: UsageEvent) -> UsageEvent {
        var out = self
        out.tokens = tokens.merged(with: other.tokens)
        out.webSearches = max(webSearches, other.webSearches)
        out.fast = fast || other.fast
        out.time = min(time, other.time)
        if out.model.isEmpty { out.model = other.model }
        if let a = loggedCost, let b = other.loggedCost { out.loggedCost = max(a, b) } else { out.loggedCost = loggedCost ?? other.loggedCost }
        return out
    }
}

/// A calendar day in the user's time zone, stored as `yyyymmdd`.
public struct Day: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let rawValue: Int32

    public init(rawValue: Int32) { self.rawValue = rawValue }

    public init(year: Int, month: Int, day: Int) {
        rawValue = Int32(year * 10_000 + month * 100 + day)
    }

    public var year: Int { Int(rawValue) / 10_000 }
    public var month: Int { (Int(rawValue) / 100) % 100 }
    public var day: Int { Int(rawValue) % 100 }

    /// Days since 1970-01-01.
    public var ordinal: Int { CivilDate.daysFromCivil(year: year, month: month, day: day) }

    public init(ordinal: Int) {
        let (y, m, d) = CivilDate.civilFromDays(ordinal)
        self.init(year: y, month: m, day: d)
    }

    public func adding(days: Int) -> Day { Day(ordinal: ordinal + days) }

    /// The first day of this day's month.
    public var monthStart: Day { Day(year: year, month: month, day: 1) }

    /// The first day of the previous month.
    public var previousMonthStart: Day {
        month == 1 ? Day(year: year - 1, month: 12, day: 1) : Day(year: year, month: month - 1, day: 1)
    }

    public func isSameMonth(as other: Day) -> Bool { year == other.year && month == other.month }

    public var description: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    public static func < (lhs: Day, rhs: Day) -> Bool { lhs.rawValue < rhs.rawValue }

    public init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(Int32.self)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rawValue)
    }
}
