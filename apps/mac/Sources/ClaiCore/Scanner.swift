import Foundation

/// Reads one kind of log. Readers only look at usage fields: token counts, model ids, timestamps
/// and ids. They never keep prompt or response text.
public protocol LogReader: AnyObject {
    /// Every tool this reader can report (one reader may serve several tools that share a format).
    var tools: [Tool] { get }
    /// The folders the reader looks in, for the settings list. Paths start with the home folder.
    func folders(home: String) -> [String]
    /// The log files to read now.
    func files(home: String) -> [String]
    /// How a file is read.
    func mode(for path: String) -> ReadMode
    /// What tells that a file changed; by default its size, modification time and inode.
    func stamp(of path: String) -> FileStamp?
    /// A parser for one file. Parsers keep state across reads of the same file.
    func parser(for path: String, home: String) -> LogParser
}

extension LogReader {
    public func mode(for path: String) -> ReadMode { .appendedLines }
    public func stamp(of path: String) -> FileStamp? { FileStamp.of(path) }
}

public enum ReadMode: Sendable {
    /// JSON Lines that only grow: each read starts where the last one stopped.
    case appendedLines
    /// A whole document, rewritten in place: read again whenever it changes.
    case wholeFile
}

/// Turns a file's content into usage events. `emit` takes a key that identifies the request across
/// every file of the reader, so a request logged twice is counted once.
public protocol LogParser: AnyObject {
    /// One line of an `.appendedLines` file.
    func consume(line: UnsafeRawBufferPointer, emit: (String, UsageEvent) -> Void)
    /// The whole content of a `.wholeFile` file.
    func consume(file path: String, emit: (String, UsageEvent) -> Void)
}

extension LogParser {
    public func consume(line: UnsafeRawBufferPointer, emit: (String, UsageEvent) -> Void) {}
    public func consume(file path: String, emit: (String, UsageEvent) -> Void) {}
}

/// What the settings list says about a tool.
public struct SourceStatus: Sendable, Equatable, Identifiable {
    public var tool: Tool
    public var folders: [String]
    public var files: Int
    public var requests: Int
    public var id: String { tool.rawValue }
    public var found: Bool { files > 0 }
}

/// The result of a refresh.
public struct ScanResult: Sendable {
    public var summary: Summary
    public var sources: [SourceStatus]
    /// Codex's latest plan limits, when its logs carry them.
    public var codexLimits: RateLimits?
    /// Whether the logs held anything new since the last refresh.
    public var changed: Bool
    public var duration: Double
}

/// Reads every tool's logs, keeps one event per request, and maintains the ledger.
///
/// The first refresh reads every log from the start; later ones read only what was appended (or
/// the documents that changed). Not thread safe: use one scanner from one queue at a time.
public final class UsageScanner: @unchecked Sendable {
    public let home: String
    public let readers: [LogReader]
    public let ledgerURL: URL?

    private struct FileState {
        var stamp: FileStamp
        var offset: UInt64
        var parser: LogParser
        var reader: Int
    }

    private var files: [String: FileState] = [:]
    private var events: [String: UsageEvent] = [:]
    private var requestsPerTool: [Tool: Int] = [:]
    public private(set) var ledger: Ledger
    private var liveIsDirty = true
    private var lastPrices = ""
    private var lastTimeZone = ""
    private var filesPerReader: [Int: Int] = [:]

    public init(home: String, readers: [LogReader] = LogReaders.all, ledgerURL: URL?) {
        self.home = home
        self.readers = readers
        self.ledgerURL = ledgerURL
        self.ledger = ledgerURL.map { Ledger.load(from: $0) } ?? Ledger()
    }

    /// The summary from the stored ledger alone: what the panel shows before the first read.
    public func storedSummary(pricer: Pricer, now: Date = Date(), timeZone: TimeZone = .current) -> Summary {
        var days = DayResolver(timeZone: timeZone)
        return Summary.make(ledger: ledger, pricer: pricer, today: days.day(at: now.timeIntervalSince1970))
    }

    /// Reads what is new in the logs and returns the up-to-date summary.
    public func refresh(pricer: Pricer, now: Date = Date(), timeZone: TimeZone = .current) -> ScanResult {
        let started = Date()
        var changed = false

        // Which files exist now, per reader.
        var wanted: [(path: String, reader: Int)] = []
        var seen = Set<String>()
        filesPerReader = [:]
        for (index, reader) in readers.enumerated() {
            let found = reader.files(home: home)
            filesPerReader[index] = found.count
            for path in found where seen.insert(path).inserted { wanted.append((path, index)) }
        }

        // Which of them changed since the last read.
        var work: [(path: String, state: FileState)] = []
        for (path, readerIndex) in wanted {
            let reader = readers[readerIndex]
            guard let stamp = reader.stamp(of: path) else { continue }
            if var state = files[path] {
                if state.stamp == stamp { continue }
                let mode = reader.mode(for: path)
                let rewritten = stamp.inode != state.stamp.inode || stamp.size < state.offset
                if rewritten && mode == .appendedLines {
                    state.offset = 0
                    state.parser = reader.parser(for: path, home: home)
                }
                state.stamp = stamp
                work.append((path, state))
            } else {
                work.append((path, FileState(stamp: stamp, offset: 0, parser: reader.parser(for: path, home: home), reader: readerIndex)))
            }
        }

        // Read them; several at a time when there are many (the first refresh reads every log).
        var results = [(state: FileState, found: [(String, UsageEvent)])?](repeating: nil, count: work.count)
        if work.count > 8 {
            results.withUnsafeMutableBufferPointer { buffer in
                DispatchQueue.concurrentPerform(iterations: work.count) { i in
                    buffer[i] = self.read(path: work[i].path, state: work[i].state)
                }
            }
        } else {
            for i in work.indices { results[i] = read(path: work[i].path, state: work[i].state) }
        }

        // Keep one event per request.
        for (i, result) in results.enumerated() {
            guard let (state, found) = result else { continue }
            files[work[i].path] = state
            for (key, event) in found {
                if let existing = events[key] {
                    let merged = existing.merged(with: event)
                    if merged != existing {
                        events[key] = merged
                        changed = true
                    }
                } else {
                    events[key] = event
                    changed = true
                }
            }
        }

        // Re-add up the ledger when the logs, the prices or the time zone changed.
        let pricesKey = pricer.list.version + "|\(pricer.list.models.count)"
        if changed || liveIsDirty || pricesKey != lastPrices || timeZone.identifier != lastTimeZone {
            var days = DayResolver(timeZone: timeZone)
            let live = Ledger.buckets(from: Array(events.values), pricer: pricer, days: &days)
            if ledger.merge(live: live), let url = ledgerURL {
                try? ledger.save(to: url)
            }
            liveIsDirty = false
            lastPrices = pricesKey
            lastTimeZone = timeZone.identifier
            requestsPerTool = [:]
            for event in events.values { requestsPerTool[event.tool, default: 0] += 1 }
        }

        var days = DayResolver(timeZone: timeZone)
        let summary = Summary.make(ledger: ledger, pricer: pricer, today: days.day(at: now.timeIntervalSince1970))
        return ScanResult(
            summary: summary,
            sources: sourceStatus(),
            codexLimits: latestCodexLimits(),
            changed: changed,
            duration: Date().timeIntervalSince(started)
        )
    }

    private func read(path: String, state: FileState) -> (state: FileState, found: [(String, UsageEvent)]) {
        var state = state
        var found: [(String, UsageEvent)] = []
        let emit: (String, UsageEvent) -> Void = { key, event in found.append((key, event)) }
        switch readers[state.reader].mode(for: path) {
        case .appendedLines:
            if let end = try? LineReader.read(path, from: state.offset, { state.parser.consume(line: $0, emit: emit) }) {
                state.offset = end
            }
        case .wholeFile:
            state.parser.consume(file: path, emit: emit)
            state.offset = state.stamp.size
        }
        return (state, found)
    }

    /// The folders every reader looks in, for watching them.
    public var watchedFolders: [String] {
        readers.flatMap { $0.folders(home: home) }.filter { FileFinder.isDirectory($0) }
    }

    private func sourceStatus() -> [SourceStatus] {
        var out: [Tool: SourceStatus] = [:]
        for (index, reader) in readers.enumerated() {
            for tool in reader.tools {
                var status = out[tool] ?? SourceStatus(tool: tool, folders: [], files: 0, requests: 0)
                status.folders.append(contentsOf: reader.folders(home: home).filter { !status.folders.contains($0) })
                out[tool] = status
            }
            // Files are counted for the reader's first tool; requests per tool below.
            if let first = reader.tools.first { out[first]?.files += filesPerReader[index] ?? 0 }
        }
        for (tool, count) in requestsPerTool { out[tool]?.requests = count }
        // A tool that shares a reader (Cowork, Claude Code) counts as found when it has requests.
        return Tool.allCases.compactMap { tool in
            guard var status = out[tool] else { return nil }
            if status.files == 0, status.requests > 0 { status.files = 1 }
            return status
        }
    }

    private func latestCodexLimits() -> RateLimits? {
        var best: RateLimits?
        for state in files.values {
            guard let parser = state.parser as? CodexParser, let limits = parser.latestLimits else { continue }
            if best == nil || limits.observedAt > best!.observedAt { best = limits }
        }
        return best
    }
}

/// Every reader clai ships with.
public enum LogReaders {
    public static var all: [LogReader] {
        [ClaudeReader(), CodexReader(), GeminiReader(), QwenReader(), OpenCodeReader()]
    }
}
