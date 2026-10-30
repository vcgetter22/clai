import Foundation
#if canImport(SQLite3)
import SQLite3
#endif

/// OpenCode keeps its sessions in `~/.local/share/opencode/opencode.db` (SQLite, since 1.2;
/// `opencode-<channel>.db` for other channels) and, in older versions, one JSON file per message in
/// `storage/message/<session>/<message>.json`.
///
/// The database has had two shapes: a `message` table whose `data` is the old message JSON
/// (`role`, `modelID`, `tokens`, `cost`, `time`), and `session_message` rows of `type` `assistant`
/// or `compaction` whose `data` has `model.id`, `tokens`, `cost` and `time`. Only those fields are
/// read, with SQLite's `json_extract`, so message text never leaves the database.
///
/// `tokens.input` excludes cached tokens, `reasoning` is billed as output, cache reads and writes
/// are separate. Forks and migrations copy messages under new ids, so a reply is keyed by its
/// time, model and token counts.
public final class OpenCodeReader: LogReader {
    public init() {}

    public var tools: [Tool] { [.opencode] }

    static func dataFolder(home: String) -> String { home + "/.local/share/opencode" }

    public func folders(home: String) -> [String] { [OpenCodeReader.dataFolder(home: home)] }

    public func files(home: String) -> [String] {
        let folder = OpenCodeReader.dataFolder(home: home)
        var out = FileFinder.files(under: folder + "/storage/message", maxDepth: 2) { $0.hasSuffix(".json") }
        #if canImport(SQLite3)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []
        out += names.filter { $0.hasPrefix("opencode") && $0.hasSuffix(".db") }.sorted().map { folder + "/" + $0 }
        #endif
        return out
    }

    public func mode(for path: String) -> ReadMode { .wholeFile }

    /// A database in WAL mode grows its `-wal` file first; both tell that it changed.
    public func stamp(of path: String) -> FileStamp? {
        guard var stamp = FileStamp.of(path) else { return nil }
        if path.hasSuffix(".db"), let wal = FileStamp.of(path + "-wal") {
            stamp.size += wal.size
            stamp.modified = max(stamp.modified, wal.modified)
        }
        return stamp
    }

    public func parser(for path: String, home: String) -> LogParser {
        #if canImport(SQLite3)
        if path.hasSuffix(".db") { return OpenCodeDatabaseParser() }
        #endif
        return OpenCodeMessageParser()
    }

    /// One reply as OpenCode records it.
    struct Reply {
        var created: Double
        var model: String
        var input: Int64
        var output: Int64
        var reasoning: Int64
        var cacheRead: Int64
        var cacheWrite: Int64
        var cost: Double?

        func emit(_ emit: (String, UsageEvent) -> Void) {
            let tokens = Tokens(input: input, output: output + reasoning, cacheRead: cacheRead, cacheWrite: cacheWrite)
            guard !tokens.isZero, let time = Timestamp.fromEpoch(created) else { return }
            let key = "opencode|\(Int64(created))|\(model)|\(input)|\(output)|\(reasoning)|\(cacheRead)|\(cacheWrite)"
            emit(key, UsageEvent(tool: .opencode, model: model, time: time, tokens: tokens, loggedCost: cost))
        }
    }
}

/// `storage/message/<session>/<message>.json`
final class OpenCodeMessageParser: LogParser {
    func consume(file path: String, emit: (String, UsageEvent) -> Void) {
        guard let message = JSON.object(atPath: path), message.string("role") == "assistant",
              let tokens = message.object("tokens"),
              let created = JSON.double(message.object("time")?["created"]) else { return }
        let cache = tokens.object("cache") ?? [:]
        OpenCodeReader.Reply(
            created: created,
            model: message.string("modelID") ?? message.object("model")?.string("id") ?? "",
            input: tokens.int("input"), output: tokens.int("output"), reasoning: tokens.int("reasoning"),
            cacheRead: cache.int("read"), cacheWrite: cache.int("write"),
            cost: JSON.double(message["cost"])
        ).emit(emit)
    }
}

#if canImport(SQLite3)
/// `opencode.db`. Each read asks only for rows created since shortly before the newest row seen.
final class OpenCodeDatabaseParser: LogParser {
    private var newest: Double = 0

    func consume(file path: String, emit: (String, UsageEvent) -> Void) {
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            sqlite3_close(db)
            return
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 2000)

        var tables = Set<String>()
        query(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('message', 'session_message')", since: nil) { row in
            if let name = row.text(0) { tables.insert(name) }
        }
        // Replies get their tokens when they finish, after they were created: look back six hours.
        let since = newest > 0 ? newest - 6 * 3_600_000 : 0
        let fields = """
            json_extract(data, '$.tokens.input'), json_extract(data, '$.tokens.output'),
            json_extract(data, '$.tokens.reasoning'), json_extract(data, '$.tokens.cache.read'),
            json_extract(data, '$.tokens.cache.write'), json_extract(data, '$.cost'),
            json_extract(data, '$.time.created'), time_created
            """
        var statements: [String] = []
        if tables.contains("session_message") {
            statements.append("SELECT coalesce(json_extract(data, '$.model.id'), json_extract(data, '$.modelID')), \(fields) FROM session_message WHERE type IN ('assistant', 'compaction') AND time_created >= ?1")
        }
        // After its move to `session_message`, OpenCode no longer writes the old table: read it once.
        if tables.contains("message") && (newest == 0 || !tables.contains("session_message")) {
            statements.append("SELECT coalesce(json_extract(data, '$.modelID'), json_extract(data, '$.model.id')), \(fields) FROM message WHERE json_extract(data, '$.role') = 'assistant' AND time_created >= ?1")
        }
        var latest = newest
        for sql in statements {
            query(db, sql, since: since) { row in
                let created = row.double(7) ?? row.double(8) ?? 0
                latest = max(latest, row.double(8) ?? created)
                OpenCodeReader.Reply(
                    created: created,
                    model: row.text(0) ?? "",
                    input: row.int(1), output: row.int(2), reasoning: row.int(3),
                    cacheRead: row.int(4), cacheWrite: row.int(5),
                    cost: row.double(6)
                ).emit(emit)
            }
        }
        newest = latest
    }

    private struct Row {
        let statement: OpaquePointer

        func text(_ i: Int32) -> String? {
            guard sqlite3_column_type(statement, i) != SQLITE_NULL, let c = sqlite3_column_text(statement, i) else { return nil }
            return String(cString: c)
        }

        func int(_ i: Int32) -> Int64 {
            sqlite3_column_type(statement, i) == SQLITE_NULL ? 0 : max(0, sqlite3_column_int64(statement, i))
        }

        func double(_ i: Int32) -> Double? {
            sqlite3_column_type(statement, i) == SQLITE_NULL ? nil : sqlite3_column_double(statement, i)
        }
    }

    private func query(_ db: OpaquePointer, _ sql: String, since: Double?, _ row: (Row) -> Void) {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { return }
        defer { sqlite3_finalize(statement) }
        if let since { sqlite3_bind_double(statement, 1, since) }
        while sqlite3_step(statement) == SQLITE_ROW { row(Row(statement: statement)) }
    }
}
#endif
