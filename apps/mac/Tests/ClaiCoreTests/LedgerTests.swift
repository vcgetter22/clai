import XCTest
@testable import ClaiCore

final class LedgerTests: XCTestCase {
    let pricer = Pricer(list: .builtIn)
    let now = Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!)

    func testHistorySurvivesDeletedLogsAndRestarts() {
        let home = TempHome()
        let ledgerURL = home.url.appendingPathComponent("support/ledger.json")
        home.write(".claude/projects/p/old.jsonl", lines([
            Fixture.claude(id: "m1", time: "2026-10-01T09:00:00.000Z"),
            Fixture.claude(id: "m2", request: "r2", time: "2026-09-15T09:00:00.000Z"),
        ]))
        home.write(".claude/projects/p/new.jsonl", lines([Fixture.claude(id: "m3", request: "r3", time: "2026-10-30T09:00:00.000Z")]))
        var scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: ledgerURL)
        let first = scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(first.monthRequests, 2)
        XCTAssertGreaterThan(first.lastMonthCost, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: ledgerURL.path))

        // Claude Code deletes transcripts after 30 days; clai restarts.
        home.remove(".claude/projects/p/old.jsonl")
        scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: ledgerURL)
        XCTAssertEqual(scanner.storedSummary(pricer: pricer, now: now, timeZone: utc), first, "the stored ledger alone gives the same numbers")
        let second = scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(second.monthRequests, 2)
        XCTAssertEqual(second.monthCost, first.monthCost, accuracy: 1e-12)
        XCTAssertEqual(second.lastMonthCost, first.lastMonthCost, accuracy: 1e-12)
    }

    func testAFreshCountReplacesTheStoredOne() {
        let day = Day(year: 2026, month: 10, day: 30)
        let key = BucketKey(day: day, tool: .claudeCode, model: "claude-opus-4-6")
        var ledger = Ledger(buckets: [key: BucketValue(tokens: Tokens(input: 100), requests: 2)])
        // Same requests, priced at a different tier after a price list change: replaced, not added.
        let longKey = BucketKey(day: day, tool: .claudeCode, model: "claude-opus-4-6", long: true)
        ledger.merge(live: [longKey: BucketValue(tokens: Tokens(input: 100), requests: 2)])
        XCTAssertEqual(ledger.buckets.count, 1)
        XCTAssertNotNil(ledger.buckets[longKey])
        // Fewer requests than stored (logs deleted): the stored day stays.
        ledger.merge(live: [key: BucketValue(tokens: Tokens(input: 10), requests: 1)])
        XCTAssertEqual(ledger.buckets[longKey]?.requests, 2)
        XCTAssertNil(ledger.buckets[key])
    }

    func testANewReaderVersionRecountsDaysWithLogs() {
        let day = Day(year: 2026, month: 10, day: 30)
        let old = Day(year: 2026, month: 8, day: 1)
        let key = BucketKey(day: day, tool: .codex, model: "gpt-5")
        let oldKey = BucketKey(day: old, tool: .codex, model: "gpt-5")
        var ledger = Ledger(buckets: [key: BucketValue(requests: 9), oldKey: BucketValue(requests: 4)], readers: Ledger.readersVersion - 1)
        ledger.merge(live: [key: BucketValue(requests: 3)])
        XCTAssertEqual(ledger.buckets[key]?.requests, 3, "an older reader overcounted: the recount wins")
        XCTAssertEqual(ledger.buckets[oldKey]?.requests, 4, "days without logs keep their history")
        XCTAssertEqual(ledger.readers, Ledger.readersVersion)
    }

    func testSavesAndLoads() throws {
        let home = TempHome()
        let url = home.url.appendingPathComponent("ledger.json")
        let ledger = Ledger(buckets: [
            BucketKey(day: Day(year: 2026, month: 10, day: 30), tool: .claudeCode, model: "claude-opus-4-6", long: false, fast: true):
                BucketValue(tokens: Tokens(input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cacheWrite1h: 5), requests: 6, webSearches: 7, loggedCost: 0),
            BucketKey(day: Day(year: 2026, month: 10, day: 29), tool: .opencode, model: "x"):
                BucketValue(tokens: Tokens(output: 9), requests: 1, loggedCost: 0.25),
        ])
        try ledger.save(to: url)
        XCTAssertEqual(Ledger.load(from: url), ledger)
        try Data("not json".utf8).write(to: url)
        XCTAssertEqual(Ledger.load(from: url).buckets.count, 0, "an unreadable ledger starts over")
    }

    func testSummaryPeriodsInTheUsersTimeZone() {
        let home = TempHome()
        home.write(".claude/projects/p/s.jsonl", lines([
            Fixture.claude(id: "a", time: "2026-10-31T23:30:00.000Z"), // Nov 1 in Berlin
            Fixture.claude(id: "b", request: "b", time: "2026-10-31T21:00:00.000Z"), // Oct 31 in Berlin
            Fixture.claude(id: "c", request: "c", time: "2026-10-02T10:00:00.000Z"),
        ]))
        let berlin = TimeZone(identifier: "Europe/Berlin")!
        let scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil)
        let at = Date(timeIntervalSince1970: Timestamp.parse("2026-11-01T08:00:00Z")!)
        let summary = scanner.refresh(pricer: pricer, now: at, timeZone: berlin).summary
        XCTAssertEqual(summary.today, Day(year: 2026, month: 11, day: 1))
        XCTAssertEqual(summary.monthRequests, 1)
        let one = summary.monthCost
        XCTAssertEqual(summary.todayCost, one, accuracy: 1e-12)
        XCTAssertEqual(summary.lastMonthCost, 2 * one, accuracy: 1e-12)
        XCTAssertEqual(summary.days.count, 30)
        XCTAssertEqual(summary.days.last?.day, summary.today)
        XCTAssertEqual(summary.days.first?.day, Day(year: 2026, month: 10, day: 3))
        XCTAssertEqual(summary.days.reduce(0) { $0 + $1.cost }, 2 * one, accuracy: 1e-12, "Oct 31 and Nov 1 are in the chart, Oct 2 is not")
        XCTAssertNil(summary.projectedMonthCost, "too early in the month to project")
        XCTAssertEqual(summary.lastUsageDay, summary.today)
    }

    func testProjectionAndVendors() {
        let home = TempHome()
        home.write(".claude/projects/p/s.jsonl", lines([Fixture.claude(id: "a", time: "2026-10-05T10:00:00.000Z")]))
        let scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil)
        let summary = scanner.refresh(pricer: pricer, now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-10T12:00:00Z")!), timeZone: utc).summary
        XCTAssertEqual(summary.projectedMonthCost!, summary.monthCost / 10 * 31, accuracy: 1e-12)
        XCTAssertEqual(summary.vendorMonthCost[.anthropic]!, summary.monthCost, accuracy: 1e-12)
        XCTAssertEqual(summary.todayCost, 0)
    }

    func testEmptyHome() {
        let home = TempHome()
        let scanner = UsageScanner(home: home.path, ledgerURL: nil)
        let result = scanner.refresh(pricer: pricer, now: now, timeZone: utc)
        XCTAssertTrue(result.summary.isEmpty)
        XCTAssertEqual(result.summary.monthCost, 0)
        XCTAssertEqual(result.summary.days.count, 30)
        XCTAssertTrue(result.sources.allSatisfy { !$0.found })
        XCTAssertEqual(Set(result.sources.map(\.tool)), Set(Tool.allCases))
    }
}

final class SampleDataTests: XCTestCase {
    func testSampleMonthLooksLikeRealUse() {
        let today = Day(year: 2026, month: 10, day: 30)
        let summary = SampleData.summary(today: today)
        XCTAssertGreaterThan(summary.monthCost, 300)
        XCTAssertLessThan(summary.monthCost, 5_000)
        XCTAssertEqual(summary.tools.first?.tool, .claudeCode)
        XCTAssertEqual(Set(summary.tools.map(\.tool)), [.claudeCode, .codex, .gemini, .cowork])
        XCTAssertTrue(summary.models.allSatisfy { $0.basis == .listed })
        XCTAssertGreaterThan(summary.lastMonthCost, 0)
        XCTAssertNotNil(summary.projectedMonthCost)
    }
}

final class SourceStatusTests: XCTestCase {
    func testEachToolListsItsOwnFoldersAndFiles() {
        let home = TempHome()
        home.write(".claude/projects/p/a.jsonl", lines([Fixture.claude(id: "msg_a")]))
        home.write(".claude/projects/p/b.jsonl", lines([Fixture.claude(id: "msg_b")]))
        home.write("Library/Application Support/Claude/local-agent-mode-sessions/o/u/s/.claude/projects/x/c.jsonl", lines([Fixture.claude(id: "msg_c")]))
        let sources = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil)
            .refresh(pricer: Pricer(list: .builtIn), now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc).sources
        let code = sources.first { $0.tool == .claudeCode }!
        let cowork = sources.first { $0.tool == .cowork }!
        XCTAssertEqual(code.files, 2)
        XCTAssertEqual(code.requests, 2)
        XCTAssertEqual(cowork.files, 1)
        XCTAssertEqual(cowork.requests, 1)
        XCTAssertFalse(code.folders.contains { $0.contains("local-agent-mode-sessions") })
        XCTAssertEqual(cowork.folders.count, 1)
        XCTAssertEqual(Format.count(1, "request"), "1 request")
        XCTAssertEqual(Format.count(1_234, "request"), "1,234 requests")
    }
}
