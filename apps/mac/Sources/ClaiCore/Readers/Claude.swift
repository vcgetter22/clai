import Foundation

/// Claude Code and Claude Cowork transcripts.
///
/// Claude Code (the CLI, the IDE extensions and local sessions of the Claude app) writes
/// `~/.claude/projects/<project>/<session>.jsonl`, with subagent transcripts beside them or in
/// `<session>/subagents/`; older versions used `~/.config/claude/projects`. Cowork, the Claude
/// app's agent mode, runs Claude Code with one config folder per session under
/// `~/Library/Application Support/Claude/local-agent-mode-sessions/…/.claude/projects`, and also
/// keeps an `audit.jsonl` per session in the Agent SDK's shape.
///
/// Every assistant line carries `message.usage`. A response with several content blocks is written
/// as several lines of the same message; later lines can carry a larger `output_tokens`, so they are
/// merged field by field (maximum). Resumed sessions and `/btw` side questions repeat earlier
/// messages in other files; one key per API message counts them once. Advisor calls
/// (`usage.iterations` of type `advisor_message`) are billed on top, under their own model.
public final class ClaudeReader: LogReader {
    public init() {}

    public var tools: [Tool] { [.claudeCode, .cowork] }

    public static func codeFolders(home: String) -> [String] {
        [home + "/.claude/projects", home + "/.config/claude/projects"]
    }

    public static func coworkFolder(home: String) -> String {
        home + "/Library/Application Support/Claude/local-agent-mode-sessions"
    }

    public func folders(home: String) -> [String] {
        ClaudeReader.codeFolders(home: home) + [ClaudeReader.coworkFolder(home: home)]
    }

    public func files(home: String) -> [String] {
        var out: [String] = []
        for folder in ClaudeReader.codeFolders(home: home) {
            out += FileFinder.files(under: folder, include: ClaudeReader.isTranscript)
        }
        // Cowork: transcripts in each session's .claude/projects, and the session's audit.jsonl.
        out += FileFinder.files(under: ClaudeReader.coworkFolder(home: home), maxDepth: 10, include: ClaudeReader.isTranscript)
            .filter { $0.contains("/.claude/projects/") || $0.hasSuffix("/audit.jsonl") }
        return out
    }

    /// `journal.jsonl` files of subagent workflows hold orchestration notes, not usage.
    static func isTranscript(_ name: String) -> Bool {
        name.hasSuffix(".jsonl") && name != "journal.jsonl"
    }

    public func parser(for path: String, home: String) -> LogParser {
        ClaudeParser(tool: path.hasPrefix(ClaudeReader.coworkFolder(home: home) + "/") ? .cowork : .claudeCode)
    }
}

final class ClaudeParser: LogParser {
    let tool: Tool

    init(tool: Tool) {
        self.tool = tool
    }

    func consume(line: UnsafeRawBufferPointer, emit: (String, UsageEvent) -> Void) {
        // Most lines are user turns, tool results and metadata; only assistant replies carry usage.
        guard JSON.contains(line, "\"usage\""), JSON.contains(line, "\"assistant\""),
              let object = JSON.object(line) else { return }
        switch object.string("type") {
        case "assistant":
            record(object, fallbackTime: nil, emit: emit)
        case "progress":
            // Older versions logged a subagent's replies inside the parent's progress lines.
            if let inner = object.object("data")?.object("message"), inner.string("type") == "assistant" {
                record(inner, fallbackTime: object.string("timestamp"), emit: emit)
            }
        default:
            return
        }
    }

    private func record(_ object: [String: Any], fallbackTime: String?, emit: (String, UsageEvent) -> Void) {
        guard let message = object.object("message"), let usage = message.object("usage") else { return }
        let model = message.string("model") ?? ""
        // `<synthetic>` marks messages Claude Code writes itself (errors, notices): no request.
        guard model != "<synthetic>", object["isApiErrorMessage"] as? Bool != true else { return }
        guard let stamp = object.string("timestamp") ?? fallbackTime, let time = Timestamp.parse(stamp) else { return }

        let requestId = object.string("requestId") ?? object.string("request_id")
        let session = object.string("sessionId") ?? object.string("session_id") ?? ""
        let key: String
        if let id = message.string("id") {
            // API message ids (`msg_…`) are unique: the same id in two files is one request.
            // Gateways may reuse ids, so theirs are qualified by request or session.
            if id.hasPrefix("msg_") || id.hasPrefix("resp_") {
                key = "claude|" + id
            } else if let requestId {
                key = "claude|" + id + "|" + requestId
            } else {
                key = "claude|" + id + "|" + session + "|" + stamp
            }
        } else {
            key = "claude|" + session + "|" + (object.string("uuid") ?? stamp)
        }

        let tokens = ClaudeParser.tokens(usage)
        let searches = Int(usage.object("server_tool_use")?.int("web_search_requests") ?? 0)
        if !tokens.isZero || searches > 0 {
            emit(key, UsageEvent(tool: tool, model: model, time: time, tokens: tokens, webSearches: searches,
                                 fast: usage.string("speed") == "fast"))
        }

        // Advisor calls: billed under the advisor's model, not included in the usage above.
        if let iterations = usage["iterations"] as? [[String: Any]] {
            for (index, iteration) in iterations.enumerated() where iteration.string("type") == "advisor_message" {
                guard let advisor = iteration.string("model") else { continue }
                let advisorTokens = ClaudeParser.tokens(iteration)
                guard !advisorTokens.isZero else { continue }
                emit(key + "|advisor|\(index)", UsageEvent(tool: tool, model: advisor, time: time, tokens: advisorTokens))
            }
        }
    }

    /// Anthropic usage fields. `input_tokens` is uncached input; cache writes are split into
    /// 5-minute and 1-hour writes when the log has the breakdown.
    static func tokens(_ usage: [String: Any]) -> Tokens {
        let writes = usage.int("cache_creation_input_tokens")
        var write5m = writes
        var write1h: Int64 = 0
        if let split = usage.object("cache_creation"),
           split["ephemeral_5m_input_tokens"] != nil || split["ephemeral_1h_input_tokens"] != nil {
            write1h = split.int("ephemeral_1h_input_tokens")
            write5m = split.int("ephemeral_5m_input_tokens")
            if writes > 0 { write1h = min(write1h, writes) }
        }
        return Tokens(
            input: usage.int("input_tokens"),
            output: usage.int("output_tokens"),
            cacheRead: usage.int("cache_read_input_tokens"),
            cacheWrite: write5m,
            cacheWrite1h: write1h
        )
    }
}
