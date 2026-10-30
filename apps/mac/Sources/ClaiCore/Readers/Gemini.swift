import Foundation

/// Gemini CLI chat recordings: `~/.gemini/tmp/<project>/chats/session-*.jsonl`, subagent chats in
/// `chats/<parent session>/<session>.jsonl`, and the older `session-*.json` documents
/// (`~/.cache/.gemini/tmp` when the CLI runs in its macOS sandbox).
///
/// A `.jsonl` recording starts with `{sessionId, projectHash, startTime, …}`; message records follow,
/// and a message is written again in full when its tokens arrive (the last record wins). A legacy
/// `.json` file is one document `{sessionId, messages: […]}`, rewritten on every save; a resumed
/// legacy chat is copied into a `.jsonl` file, so messages are keyed by session and message id.
///
/// Model replies carry `model` and `tokens: {input, output, cached, thoughts, tool, total}`.
/// `input` is the whole prompt with `cached` inside it, `thoughts` are billed as output and `tool`
/// is extra prompt input.
public final class GeminiReader: LogReader {
    public init() {}

    public var tools: [Tool] { [.gemini] }

    public func folders(home: String) -> [String] {
        [home + "/.gemini/tmp", home + "/.cache/.gemini/tmp"]
    }

    public func files(home: String) -> [String] {
        folders(home: home).flatMap { root in
            FileFinder.files(under: root, maxDepth: 5) { $0.hasSuffix(".jsonl") || $0.hasSuffix(".json") }
                .filter { $0.contains("/chats/") }
        }
    }

    public func mode(for path: String) -> ReadMode {
        path.hasSuffix(".jsonl") ? .appendedLines : .wholeFile
    }

    public func parser(for path: String, home: String) -> LogParser {
        GeminiParser(path: path)
    }
}

final class GeminiParser: LogParser {
    private var session: String

    init(path: String) {
        session = ((path as NSString).lastPathComponent as NSString).deletingPathExtension
    }

    func consume(line: UnsafeRawBufferPointer, emit: (String, UsageEvent) -> Void) {
        guard JSON.contains(line, "\"tokens\"") || JSON.contains(line, "\"sessionId\""),
              let object = JSON.object(line) else { return }
        // `{$set: {…}}` updates the header and may hold a full checkpoint of the messages;
        // `$patch` and `$rewindTo` records carry no usage (rewound messages were still billed).
        if let set = object.object("$set") {
            if let id = set.string("sessionId") { session = id }
            for message in set["messages"] as? [[String: Any]] ?? [] { self.message(message, emit: emit) }
            return
        }
        if object.object("tokens") == nil, let id = object.string("sessionId") {
            session = id
            return
        }
        message(object, emit: emit)
    }

    func consume(file path: String, emit: (String, UsageEvent) -> Void) {
        guard let document = JSON.object(atPath: path), let messages = document["messages"] as? [[String: Any]] else { return }
        if let id = document.string("sessionId") { session = id }
        for message in messages { self.message(message, emit: emit) }
    }

    private func message(_ message: [String: Any], emit: (String, UsageEvent) -> Void) {
        guard let tokens = message.object("tokens"),
              let stamp = message.string("timestamp"), let time = Timestamp.parse(stamp) else { return }
        let prompt = tokens.int("input")
        let cached = min(tokens.int("cached"), prompt)
        let usage = Tokens(
            input: prompt - cached + tokens.int("tool"),
            output: tokens.int("output") + tokens.int("thoughts"),
            cacheRead: cached
        )
        guard !usage.isZero else { return }
        let id = message.string("id") ?? stamp
        emit("gemini|\(session)|\(id)", UsageEvent(tool: .gemini, model: message.string("model") ?? "", time: time, tokens: usage))
    }
}

/// Qwen Code chat recordings: `~/.qwen/projects/<project>/chats/<session>.jsonl`.
///
/// Assistant records carry `model` and Gemini-style `usageMetadata` (`promptTokenCount` with
/// `cachedContentTokenCount` inside it, `candidatesTokenCount`, `thoughtsTokenCount`,
/// `totalTokenCount`). With OpenAI-compatible models the candidates already include the
/// thoughts, so output is the candidates plus whatever of the total is not prompt or candidates.
/// `/branch` copies records with their `uuid`, which keys them. Subagents write
/// `subagents/<session>/agent-<id>.jsonl` without a model; it is in `agent-<id>.meta.json` beside it.
public final class QwenReader: LogReader {
    public init() {}

    public var tools: [Tool] { [.qwen] }

    public func folders(home: String) -> [String] { [home + "/.qwen/projects"] }

    public func files(home: String) -> [String] {
        FileFinder.files(under: home + "/.qwen/projects", maxDepth: 4) { $0.hasSuffix(".jsonl") }
            .filter { $0.contains("/chats/") || ($0.contains("/subagents/") && ($0 as NSString).lastPathComponent.hasPrefix("agent-")) }
    }

    public func parser(for path: String, home: String) -> LogParser {
        guard path.contains("/subagents/") else { return QwenParser(model: nil) }
        let meta = String(path.dropLast(".jsonl".count)) + ".meta.json"
        return QwenParser(model: FileFinder.isSafe(meta) ? JSON.object(atPath: meta)?.string("model") : nil)
    }
}

final class QwenParser: LogParser {
    /// A subagent's model, from its meta file; its records do not name it.
    let model: String?

    init(model: String?) {
        self.model = model
    }

    func consume(line: UnsafeRawBufferPointer, emit: (String, UsageEvent) -> Void) {
        guard JSON.contains(line, "\"usageMetadata\""), let object = JSON.object(line),
              object.string("type") == "assistant",
              let usage = object.object("usageMetadata"),
              let stamp = object.string("timestamp"), let time = Timestamp.parse(stamp) else { return }
        let prompt = usage.int("promptTokenCount")
        let cached = min(usage.int("cachedContentTokenCount"), prompt)
        let candidates = usage.int("candidatesTokenCount")
        let total = usage.int("totalTokenCount")
        let extra = total > 0 ? max(0, total - prompt - candidates) : usage.int("thoughtsTokenCount")
        let tokens = Tokens(input: prompt - cached, output: candidates + extra, cacheRead: cached)
        guard !tokens.isZero else { return }
        let id = object.string("uuid") ?? ((object.string("sessionId") ?? "") + stamp)
        emit("qwen|" + id, UsageEvent(tool: .qwen, model: object.string("model") ?? model ?? "", time: time, tokens: tokens))
    }
}
