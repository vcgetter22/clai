import Foundation

/// Plan limits as Codex last logged them: how much of the 5-hour and weekly windows is used.
public struct RateLimits: Sendable, Equatable {
    public struct Window: Sendable, Equatable {
        /// 0 to 100.
        public var usedPercent: Double
        public var windowMinutes: Int?
        /// When the window resets, seconds since 1970.
        public var resetsAt: Double?
    }

    public var primary: Window?
    public var secondary: Window?
    /// `plus`, `pro`, `business`… as Codex reports the ChatGPT plan.
    public var planType: String?
    /// When Codex logged these numbers.
    public var observedAt: Double
}

/// OpenAI Codex (the CLI, the IDE extension and the Codex app) session logs:
/// `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and `~/.codex/archived_sessions/`.
///
/// Each line is `{timestamp, type, payload}`. `turn_context` (and `thread_settings_applied`) name
/// the model and service tier. `event_msg` lines of payload type `token_count` carry the thread's
/// running `total_token_usage` and the last response's `last_token_usage`. A response counts when
/// the running total moved: Codex repeats the event (on rate-limit updates, for example) without
/// new usage, and after compaction writes estimates without input or output, which are skipped.
///
/// Forks copy the parent's lines into the child's file, and old threads move to
/// `archived_sessions`. Each response is keyed by its token numbers, so copies count once.
///
/// OpenAI counts cached tokens and cache writes inside `input_tokens`, and reasoning inside
/// `output_tokens`.
public final class CodexReader: LogReader {
    private var config: (stamp: FileStamp?, model: String?, tier: String?) = (nil, nil, nil)

    public init() {}

    public var tools: [Tool] { [.codex] }

    public func folders(home: String) -> [String] {
        [home + "/.codex/sessions", home + "/.codex/archived_sessions"]
    }

    public func files(home: String) -> [String] {
        folders(home: home).flatMap { FileFinder.files(under: $0) { $0.hasSuffix(".jsonl") } }
    }

    public func parser(for path: String, home: String) -> LogParser {
        let defaults = configDefaults(home: home)
        return CodexParser(defaultModel: defaults.model, defaultTier: defaults.tier)
    }

    /// `model` and `service_tier` from the top of `~/.codex/config.toml`: what Codex uses when a
    /// session does not log them.
    func configDefaults(home: String) -> (model: String?, tier: String?) {
        let path = home + "/.codex/config.toml"
        // A config.toml linked from a guarded folder (Documents, iCloud Drive) is not read.
        guard FileFinder.isSafe(path) else { return (nil, nil) }
        let stamp = FileStamp.of(path)
        if stamp == config.stamp { return (config.model, config.tier) }
        var model: String?
        var tier: String?
        if let text = try? String(contentsOfFile: path, encoding: .utf8) {
            for raw in text.split(whereSeparator: \.isNewline) {
                let line = raw.trimmingCharacters(in: .whitespaces)
                if line.hasPrefix("[") { break }
                for (name, apply) in [("model", { model = $0 }), ("service_tier", { tier = $0 })] as [(String, (String) -> Void)] {
                    guard line.hasPrefix(name), let eq = line.firstIndex(of: "=") else { continue }
                    guard line[..<eq].trimmingCharacters(in: .whitespaces) == name else { continue }
                    let value = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
                    if value.hasPrefix("\""), let end = value.dropFirst().firstIndex(of: "\"") {
                        apply(String(value[value.index(after: value.startIndex)..<end]))
                    }
                }
            }
        }
        config = (stamp, model, tier)
        return (model, tier)
    }
}

final class CodexParser: LogParser {
    private struct Counts: Equatable {
        var input: Int64
        var cached: Int64
        var cacheWrite: Int64
        var output: Int64
        var reasoning: Int64
        var total: Int64

        init(_ o: [String: Any]) {
            input = o.int("input_tokens")
            cached = o.int("cached_input_tokens")
            cacheWrite = o.int("cache_write_input_tokens")
            output = o.int("output_tokens")
            reasoning = o.int("reasoning_output_tokens")
            total = o.int("total_tokens")
        }

        init(input: Int64, cached: Int64, cacheWrite: Int64, output: Int64, reasoning: Int64, total: Int64) {
            self.input = input
            self.cached = cached
            self.cacheWrite = cacheWrite
            self.output = output
            self.reasoning = reasoning
            self.total = total
        }

        /// What grew since `earlier`, never negative.
        func minus(_ earlier: Counts) -> Counts {
            Counts(input: max(0, input - earlier.input), cached: max(0, cached - earlier.cached),
                   cacheWrite: max(0, cacheWrite - earlier.cacheWrite), output: max(0, output - earlier.output),
                   reasoning: max(0, reasoning - earlier.reasoning), total: max(0, total - earlier.total))
        }

        var text: String { "\(input).\(cached).\(cacheWrite).\(output).\(reasoning).\(total)" }

        static let zero = Counts(input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0)
    }

    private var model: String
    private var tier: String?
    private var lastTotal: Counts?
    private var lastLast: Counts?
    private(set) var latestLimits: RateLimits?

    init(defaultModel: String?, defaultTier: String?) {
        model = defaultModel ?? ""
        tier = defaultTier
    }

    func consume(line: UnsafeRawBufferPointer, emit: (String, UsageEvent) -> Void) {
        guard JSON.contains(line, "\"turn_context\"") || JSON.contains(line, "\"token_count\"") || JSON.contains(line, "\"thread_settings") ,
              let object = JSON.object(line), let payload = object.object("payload") else { return }
        switch object.string("type") {
        case "turn_context":
            if let model = payload.string("model") { self.model = model }
            if let tier = payload.string("service_tier") { self.tier = tier }
        case "event_msg":
            switch payload.string("type") {
            case "thread_settings_applied":
                let settings = payload.object("thread_settings") ?? payload
                if let model = settings.string("model") { self.model = model }
                if let tier = settings.string("service_tier") { self.tier = tier }
            case "token_count":
                tokenCount(payload, time: object.string("timestamp").flatMap(Timestamp.parse) ?? 0, emit: emit)
            default:
                return
            }
        default:
            return
        }
    }

    private func tokenCount(_ payload: [String: Any], time: Double, emit: (String, UsageEvent) -> Void) {
        if let limits = payload.object("rate_limits") { readLimits(limits, at: time) }
        guard let info = payload.object("info") else { return }
        let total = info.object("total_token_usage").map(Counts.init)
        let last = info.object("last_token_usage").map(Counts.init)
        defer {
            if let total { lastTotal = total }
            if let last { lastLast = last }
        }
        if let total, total == lastTotal { return } // repeated without new usage

        let usage: Counts
        if let last, last != lastLast || total == nil {
            // An estimate after compaction or a context-window fill has no input or output.
            guard last.input > 0 || last.output > 0 else { return }
            usage = last
        } else if let total {
            // Older logs have no `last`; and a response cut short (output limit, interrupted
            // compaction) moves the total but leaves `last` as it was: what the total grew by.
            usage = total.minus(lastTotal ?? .zero)
            guard usage.input > 0 || usage.output > 0 else { return }
        } else {
            return
        }
        guard time > 0 else { return }
        let cached = min(usage.cached, usage.input)
        let writes = min(usage.cacheWrite, usage.input - cached)
        emit("codex|" + (total?.text ?? "") + "|" + usage.text, UsageEvent(
            tool: .codex,
            model: model.isEmpty ? "gpt-5" : model,
            time: time,
            tokens: Tokens(input: usage.input - cached - writes, output: usage.output, cacheRead: cached, cacheWrite: writes),
            fast: tier == "priority" || tier == "fast" || tier == "ultrafast"
        ))
    }

    private func readLimits(_ object: [String: Any], at time: Double) {
        // Codex can report several limit families; the main one is `codex` (or unnamed).
        if let id = object.string("limit_id"), id != "codex" { return }
        func window(_ key: String) -> RateLimits.Window? {
            guard let w = object.object(key), let used = JSON.double(w["used_percent"]) else { return nil }
            var resets: Double?
            if let at = JSON.double(w["resets_at"]) {
                resets = Timestamp.fromEpoch(at)
            } else if let seconds = JSON.double(w["resets_in_seconds"]), time > 0 {
                resets = time + seconds
            }
            let minutes = JSON.int(w["window_minutes"])
            return RateLimits.Window(usedPercent: used, windowMinutes: minutes > 0 ? Int(minutes) : nil, resetsAt: resets)
        }
        let limits = RateLimits(primary: window("primary"), secondary: window("secondary"), planType: object.string("plan_type"), observedAt: time)
        guard limits.primary != nil || limits.secondary != nil else { return }
        if latestLimits == nil || time >= latestLimits!.observedAt { latestLimits = limits }
    }
}
