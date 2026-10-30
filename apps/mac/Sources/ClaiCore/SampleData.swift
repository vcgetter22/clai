import Foundation

/// A made-up month of usage for screenshots and previews (`clai --render`). Never shown as real data.
public enum SampleData {
    /// A ledger with 60 days of plausible usage ending on `today`, a few hours of each day in `timeZone`.
    public static func ledger(today: Day, timeZone: TimeZone = .current) -> Ledger {
        let days = DayResolver(timeZone: timeZone)
        var buckets: [BucketKey: BucketValue] = [:]
        var seed: UInt64 = 0x5EED
        func random() -> Double {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double(seed >> 11) / Double(1 << 53)
        }
        for offset in 0..<60 {
            let day = today.adding(days: -offset)
            let weekday = (day.ordinal + 4) % 7 // 0 = Sunday
            let weekend = weekday == 0 || weekday == 6
            let busy = (weekend ? 0.25 : 1.0) * (0.55 + random() * 0.9)
            // Between 9:00 and 17:00 local time.
            let quarter = Quarter(time: days.start(of: day).timeIntervalSince1970 + Double(9 + offset % 8) * 3600)
            func add(_ tool: Tool, _ model: String, requests: Int, input: Int64, output: Int64, read: Int64, write: Int64) {
                let n = max(0, Int(Double(requests) * busy))
                guard n > 0 else { return }
                let f = Double(n)
                let tokens = Tokens(input: Int64(Double(input) * f), output: Int64(Double(output) * f),
                                    cacheRead: Int64(Double(read) * f), cacheWrite: Int64(Double(write) * f))
                buckets[BucketKey(quarter: quarter, tool: tool, model: model), default: BucketValue()].tokens += tokens
                buckets[BucketKey(quarter: quarter, tool: tool, model: model), default: BucketValue()].requests += n
            }
            add(.claudeCode, "claude-opus-5-5", requests: 420, input: 60, output: 900, read: 62_000, write: 2_400)
            add(.claudeCode, "claude-haiku-5-5", requests: 160, input: 900, output: 220, read: 9_000, write: 600)
            add(.codex, "gpt-6.1-sol", requests: 180, input: 3_500, output: 1_100, read: 48_000, write: 0)
            if offset % 3 == 0 { add(.gemini, "gemini-3.1-pro-preview", requests: 60, input: 9_000, output: 700, read: 30_000, write: 0) }
            if offset % 4 == 1 { add(.cowork, "claude-sonnet-5-5", requests: 90, input: 80, output: 700, read: 40_000, write: 1_800) }
        }
        return Ledger(buckets: buckets)
    }

    /// The sample month as the panel shows it at `now`.
    public static func summary(now: Date = Date(), timeZone: TimeZone = .current, pricer: Pricer = Pricer(list: .builtIn)) -> Summary {
        var days = DayResolver(timeZone: timeZone)
        let today = days.day(at: now.timeIntervalSince1970)
        return Summary.make(ledger: ledger(today: today, timeZone: timeZone), pricer: pricer, now: now.timeIntervalSince1970, days: &days)
    }

    public static let sources: [SourceStatus] = [
        SourceStatus(tool: .claudeCode, folders: ["~/.claude/projects"], files: 1_284, requests: 41_877),
        SourceStatus(tool: .cowork, folders: ["~/Library/Application Support/Claude/local-agent-mode-sessions"], files: 96, requests: 3_120),
        SourceStatus(tool: .codex, folders: ["~/.codex/sessions"], files: 412, requests: 9_960),
        SourceStatus(tool: .gemini, folders: ["~/.gemini/tmp"], files: 37, requests: 1_204),
        SourceStatus(tool: .qwen, folders: ["~/.qwen/projects"], files: 0, requests: 0),
        SourceStatus(tool: .opencode, folders: ["~/.local/share/opencode"], files: 0, requests: 0),
    ]

    public static let codexLimits = RateLimits(
        primary: .init(usedPercent: 34, windowMinutes: 300, resetsAt: nil),
        secondary: .init(usedPercent: 61, windowMinutes: 10_080, resetsAt: nil),
        planType: "pro",
        observedAt: 0
    )
}
