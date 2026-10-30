#if canImport(SQLite3)
import SQLite3
import XCTest
@testable import ClaiCore

/// OpenCode's SQLite database (macOS: the system SQLite).
final class OpenCodeDatabaseTests: XCTestCase {
    private func reply(model: String, created: Int, input: Int, output: Int, v2: Bool) -> String {
        let model = v2 ? #""model":{"id":"\#(model)","providerID":"x"}"# : #""role":"assistant","modelID":"\#(model)","providerID":"x""#
        return #"{\#(model),"time":{"created":\#(created)},"cost":0.5,"tokens":{"input":\#(input),"output":\#(output),"reasoning":10,"cache":{"read":1000,"write":0}}}"#
    }

    func testReadsBothTablesCountsCopiesOnceAndReadsNewRows() throws {
        let home = TempHome()
        let folder = home.path + "/.local/share/opencode"
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let path = folder + "/opencode.db"
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(path, &db), SQLITE_OK)
        func exec(_ sql: String) { XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK, sql) }
        func quoted(_ text: String) -> String { "'" + text.replacingOccurrences(of: "'", with: "''") + "'" }
        exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)")
        exec("CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, time_updated INTEGER, data TEXT)")
        let first = 1_793_350_000_000, second = 1_793_351_000_000
        // An old reply, and the same reply moved into session_message under a new id.
        exec("INSERT INTO message VALUES ('m1', 's1', \(first), \(first), \(quoted(reply(model: "claude-sonnet-4-5", created: first, input: 100, output: 50, v2: false))))")
        exec("INSERT INTO session_message VALUES ('x1', 's1', 'assistant', 1, \(first), \(first), \(quoted(reply(model: "claude-sonnet-4-5", created: first, input: 100, output: 50, v2: true))))")
        // A newer reply, and its copy in a forked session.
        exec("INSERT INTO session_message VALUES ('x2', 's1', 'assistant', 2, \(second), \(second), \(quoted(reply(model: "gpt-5.2", created: second, input: 200, output: 20, v2: true))))")
        exec("INSERT INTO session_message VALUES ('f2', 's2', 'assistant', 2, \(second), \(second), \(quoted(reply(model: "gpt-5.2", created: second, input: 200, output: 20, v2: true))))")
        exec("INSERT INTO session_message VALUES ('u3', 's1', 'user', 3, \(second), \(second), '{\"content\":\"...\"}')")
        sqlite3_close(db)

        let scanner = UsageScanner(home: home.path, readers: [OpenCodeReader()], ledgerURL: nil)
        let pricer = Pricer(list: .builtIn)
        let now = Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!)
        var result = scanner.refresh(pricer: pricer, now: now, timeZone: utc)
        XCTAssertEqual(result.summary.monthRequests, 2)
        XCTAssertEqual(Set(result.summary.models.map(\.model)), ["claude-sonnet-4-5", "gpt-5.2"])
        XCTAssertEqual(result.sources.first { $0.tool == .opencode }?.files, 1)

        XCTAssertEqual(sqlite3_open(path, &db), SQLITE_OK)
        let third = 1_793_352_000_000
        exec("INSERT INTO session_message VALUES ('x4', 's1', 'assistant', 4, \(third), \(third), \(quoted(reply(model: "gpt-5.2", created: third, input: 300, output: 30, v2: true))))")
        sqlite3_close(db)
        result = scanner.refresh(pricer: pricer, now: now, timeZone: utc)
        XCTAssertTrue(result.changed)
        XCTAssertEqual(result.summary.monthRequests, 3)
    }
}
#endif
