import XCTest
@testable import ClaiCore

/// `CLAI_BENCH=1 swift test --filter Benchmark`: a cold read of a large history.
final class BenchmarkTests: XCTestCase {
    func testColdScanOfALargeHistory() throws {
        guard ProcessInfo.processInfo.environment["CLAI_BENCH"] == "1" else { throw XCTSkip("set CLAI_BENCH=1") }
        let home = TempHome()
        let filler = String(repeating: "lorem ipsum dolor sit amet ", count: 400) // ~10 KB of text per line
        var total = 0
        for file in 0..<200 {
            var text = ""
            for i in 0..<250 {
                var user = Fixture.claudeUser()
                user["message"] = ["role": "user", "content": filler]
                text += lines([user])
                var assistant = Fixture.claude(id: "msg_\(file)_\(i)", request: "req_\(file)_\(i)", time: "2026-10-\(10 + i % 20)T10:00:00.000Z")
                var message = assistant["message"] as! [String: Any]
                message["content"] = [["type": "text", "text": filler]]
                assistant["message"] = message
                text += lines([assistant, assistant])
            }
            total += text.utf8.count
            home.write(".claude/projects/p\(file % 20)/s\(file).jsonl", text)
        }
        let scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil)
        let started = Date()
        let result = scanner.refresh(pricer: Pricer(list: .builtIn), now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc)
        let seconds = Date().timeIntervalSince(started)
        print("BENCH cold scan: \(total / 1_000_000) MB, \(result.summary.monthRequests) requests in \(String(format: "%.2f", seconds)) s")
        XCTAssertEqual(result.summary.monthRequests, 50_000)
        let again = Date()
        _ = scanner.refresh(pricer: Pricer(list: .builtIn), now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc)
        print("BENCH warm refresh: \(String(format: "%.3f", Date().timeIntervalSince(again))) s")
    }
}
