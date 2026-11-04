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
        let quarter = Quarter(time: Timestamp.parse("2026-10-30T10:00:00Z")!)
        let key = BucketKey(quarter: quarter, tool: .claudeCode, model: "claude-opus-4-6")
        var ledger = Ledger(buckets: [key: BucketValue(tokens: Tokens(input: 100), requests: 2)])
        // Same requests, priced at a different tier after a price list change: replaced, not added.
        let longKey = BucketKey(quarter: quarter, tool: .claudeCode, model: "claude-opus-4-6", long: true)
        ledger.merge(live: [longKey: BucketValue(tokens: Tokens(input: 100), requests: 2)])
        XCTAssertEqual(ledger.buckets.count, 1)
        XCTAssertNotNil(ledger.buckets[longKey])
        // Fewer requests than stored (logs deleted): the stored day stays.
        ledger.merge(live: [key: BucketValue(tokens: Tokens(input: 10), requests: 1)])
        XCTAssertEqual(ledger.buckets[longKey]?.requests, 2)
        XCTAssertNil(ledger.buckets[key])
    }

    func testANewReaderVersionRecountsWhereTheLogsAreComplete() {
        let recent = Timestamp.parse("2026-10-30T10:00:00Z")!
        let key = BucketKey(quarter: Quarter(time: recent), tool: .codex, model: "gpt-5")
        let oldKey = BucketKey(quarter: Quarter(time: Timestamp.parse("2026-08-01T10:00:00Z")!), tool: .codex, model: "gpt-5")
        // Logs kept since Oct 1; Sep 28 has a long session's requests left, the others were deleted.
        let partKey = BucketKey(quarter: Quarter(time: Timestamp.parse("2026-09-28T10:00:00Z")!), tool: .codex, model: "gpt-5")
        let gone = BucketKey(quarter: Quarter(time: Timestamp.parse("2026-10-20T10:00:00Z")!), tool: .codex, model: "gpt-5")
        var ledger = Ledger(buckets: [key: BucketValue(requests: 9), oldKey: BucketValue(requests: 4), partKey: BucketValue(requests: 10),
                                      gone: BucketValue(requests: 2)],
                            readers: Ledger.readersVersion - 1)
        ledger.merge(live: [key: BucketValue(requests: 3), partKey: BucketValue(requests: 4)],
                     completeSince: [.codex: Timestamp.parse("2026-10-01T00:00:00Z")!])
        XCTAssertEqual(ledger.buckets[key]?.requests, 3, "an older reader overcounted: the recount wins")
        XCTAssertNil(ledger.buckets[gone], "complete logs without these requests: an older reader made them up")
        XCTAssertEqual(ledger.buckets[partKey]?.requests, 10, "before the logs are complete, the larger count stays")
        XCTAssertEqual(ledger.buckets[oldKey]?.requests, 4, "quarter hours without logs keep their history")
        XCTAssertEqual(ledger.readers, Ledger.readersVersion)
    }

    func testTimeZoneChangesMoveNothingStored() {
        let home = TempHome()
        let ledgerURL = home.url.appendingPathComponent("support/ledger.json")
        home.write(".claude/projects/p/s.jsonl", lines([
            Fixture.claude(id: "a", time: "2026-10-29T22:00:00.000Z"), // Oct 30 in Moscow
            Fixture.claude(id: "b", request: "b", time: "2026-10-30T01:00:00.000Z"),
            Fixture.claude(id: "c", request: "c", time: "2026-10-28T21:30:00.000Z"), // Oct 29 in Moscow
        ]))
        let moscow = TimeZone(identifier: "Europe/Moscow")!
        let la = TimeZone(identifier: "America/Los_Angeles")!
        var scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: ledgerURL)
        let inUTC = scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary
        let one = inUTC.monthCost / 3
        XCTAssertEqual(inUTC.todayCost, one, accuracy: 1e-12)
        let inMoscow = scanner.refresh(pricer: pricer, now: now, timeZone: moscow).summary
        XCTAssertEqual(inMoscow.monthRequests, 3)
        XCTAssertEqual(inMoscow.todayCost, 2 * one, accuracy: 1e-12)
        XCTAssertEqual(inMoscow.monthCost, inUTC.monthCost, accuracy: 1e-12)

        // A restart in another zone, then home again, with the logs gone: still three requests.
        scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: ledgerURL)
        XCTAssertEqual(scanner.refresh(pricer: pricer, now: now, timeZone: la).summary.monthRequests, 3)
        home.remove(".claude/projects/p/s.jsonl")
        scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: ledgerURL)
        let back = scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(back.monthRequests, 3)
        XCTAssertEqual(back.monthCost, inUTC.monthCost, accuracy: 1e-12)
        XCTAssertEqual(back.days.map(\.cost), inUTC.days.map(\.cost))
    }

    func testSavesAndLoads() throws {
        let home = TempHome()
        let url = home.url.appendingPathComponent("ledger.json")
        let ledger = Ledger(buckets: [
            BucketKey(quarter: Quarter(rawValue: 1_986_000), tool: .claudeCode, model: "claude-opus-4-6", long: false, fast: true):
                BucketValue(tokens: Tokens(input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cacheWrite1h: 5), requests: 6, webSearches: 7, loggedCost: 0),
            BucketKey(quarter: Quarter(rawValue: 1_985_900), tool: .opencode, model: "x"):
                BucketValue(tokens: Tokens(output: 9), requests: 1, loggedCost: 0.25),
        ])
        try ledger.save(to: url)
        XCTAssertEqual(Ledger.load(from: url), ledger)
    }

    func testALedgerThatCannotBeReadIsNeverWrittenOver() throws {
        let home = TempHome()
        let url = home.url.appendingPathComponent("ledger.json")
        let key = BucketKey(quarter: Quarter(rawValue: 1_986_000), tool: .codex, model: "gpt-5")

        // Damaged: kept aside, and clai starts over.
        try Data("not json".utf8).write(to: url)
        var ledger = Ledger.load(from: url)
        XCTAssertEqual(ledger.buckets.count, 0)
        XCTAssertFalse(ledger.isReadOnly)
        let aside = try FileManager.default.contentsOfDirectory(atPath: home.path).filter { $0.hasPrefix("ledger-unreadable-") }
        XCTAssertEqual(aside.count, 1)
        XCTAssertEqual(try String(contentsOfFile: home.path + "/" + aside[0], encoding: .utf8), "not json")

        // Written by a newer clai: left exactly as it is.
        let newer = #"{"format":99,"readers":7,"rows":[{"q":1,"x":"something new"}]}"#
        try Data(newer.utf8).write(to: url)
        ledger = Ledger.load(from: url)
        XCTAssertTrue(ledger.isReadOnly)
        ledger.merge(live: [key: BucketValue(requests: 1)])
        try ledger.save(to: url)
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), newer)
    }

    func testRowsOfToolsANewerClaiKnowsSurviveARewrite() throws {
        let home = TempHome()
        let url = home.url.appendingPathComponent("ledger.json")
        let file = #"{"format":2,"readers":1,"rows":[{"q":1986000,"t":"copilot-cli","m":"gpt-6","n":3,"k":{"i":5}},{"q":1986000,"t":"codex","m":"gpt-5","n":2,"k":{"i":7}}]}"#
        try Data(file.utf8).write(to: url)
        var ledger = Ledger.load(from: url)
        XCTAssertEqual(ledger.buckets.count, 1)
        ledger.merge(live: [BucketKey(quarter: Quarter(rawValue: 1_986_001), tool: .codex, model: "gpt-5"): BucketValue(requests: 1)])
        try ledger.save(to: url)
        let saved = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(saved.contains("copilot-cli"))
        XCTAssertEqual(Ledger.load(from: url).buckets.count, 2)
    }

    func testRequestsWithoutAPriceAreCountedNotShownAsZero() {
        let home = TempHome()
        home.write(".claude/projects/p/s.jsonl", lines([
            Fixture.claude(id: "a", model: "someone-elses-model", time: "2026-10-30T09:00:00.000Z"),
            Fixture.claude(id: "b", request: "b", model: "someone-elses-model", time: "2026-10-30T09:30:00.000Z"),
        ]))
        let summary = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil)
            .refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertFalse(summary.isEmpty)
        XCTAssertEqual(summary.monthCost, 0)
        XCTAssertEqual(summary.monthUnpriced, 2)
        XCTAssertEqual(summary.todayUnpriced, 2)
        XCTAssertEqual(summary.tools.first?.unpricedRequests, 2)
        XCTAssertEqual(summary.models.first?.basis, .unpriced)
        XCTAssertEqual(Format.usdShort(summary.monthCost, unpriced: summary.monthUnpriced), "–")
        XCTAssertEqual(Format.usd(summary.monthCost, unpriced: summary.monthUnpriced), "–")
        XCTAssertEqual(Format.usd(12.5, unpriced: 3), "$12.50", "a priced part shows; the rest is noted")
        XCTAssertEqual(Format.usdShort(0, unpriced: 0), "$0", "no usage is a known zero")
    }

    func testAModelsPriceBasisDoesNotDependOnOrder() {
        // A model clai has no price for, with a logged cost on one day and none on another.
        let first = BucketKey(quarter: Quarter(time: Timestamp.parse("2026-10-29T10:00:00Z")!), tool: .opencode, model: "free-or-not")
        let second = BucketKey(quarter: Quarter(time: Timestamp.parse("2026-10-30T10:00:00Z")!), tool: .opencode, model: "free-or-not")
        for _ in 0..<20 {
            let ledger = Ledger(buckets: [first: BucketValue(tokens: Tokens(input: 10), requests: 1, loggedCost: 0.5),
                                          second: BucketValue(tokens: Tokens(input: 10), requests: 1)])
            var days = DayResolver(timeZone: utc)
            let model = Summary.make(ledger: ledger, pricer: pricer, now: now.timeIntervalSince1970, days: &days).models[0]
            XCTAssertEqual(model.basis, .logged)
            XCTAssertEqual(model.cost, 0.5)
            XCTAssertEqual(model.unpricedRequests, 1)
        }
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
        XCTAssertEqual(Set(result.sources.map(\.tool)), Set(Tool.allCases.filter { !$0.isCloud }))
    }
}

final class SampleDataTests: XCTestCase {
    func testSampleMonthLooksLikeRealUse() {
        let summary = SampleData.summary(now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc)
        XCTAssertGreaterThan(summary.monthCost, 300)
        XCTAssertLessThan(summary.monthCost, 5_000)
        XCTAssertEqual(summary.tools.first?.tool, .claudeCode)
        XCTAssertEqual(Set(summary.tools.map(\.tool)), [.claudeCode, .codex, .gemini, .cowork])
        XCTAssertEqual(summary.claudeEstimate?.isReady, true)
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

final class CorruptLogTests: XCTestCase {
    /// Absurd numbers, wrong types and broken lines in any log must not stop clai.
    func testGarbageNeverCrashes() {
        let home = TempHome()
        var huge = Fixture.claude(id: "msg_huge", input: 1, output: 1)
        var message = huge["message"] as! [String: Any]
        message["usage"] = ["input_tokens": 1e300, "output_tokens": -5, "cache_read_input_tokens": "lots",
                            "cache_creation_input_tokens": 9.3e18, "server_tool_use": ["web_search_requests": 1e30]]
        huge["message"] = message
        home.write(".claude/projects/p/s.jsonl", lines([huge, Fixture.claude(id: "msg_ok")]) + "{not json\n" + "\u{0}\u{1}garbage\n")
        home.write(".claude/projects/p/t.jsonl", lines([Fixture.claude(id: "msg_far", time: "9999-12-31T23:59:59Z")]))
        home.write(".codex/sessions/2026/10/30/rollout-x.jsonl", lines([
            ["timestamp": "2026-10-30T09:00:00.000Z", "type": "event_msg",
             "payload": ["type": "token_count", "info": ["total_token_usage": ["input_tokens": 1e300], "last_token_usage": ["input_tokens": "x", "output_tokens": 1e40]]]],
        ]))
        home.write(".gemini/tmp/p/chats/session-1.json", #"{"sessionId":"s","messages":[{"id":"g","timestamp":"2026-10-30T09:00:00Z","type":"gemini","tokens":{"input":-1,"output":1e308,"cached":"?"}}]}"#)
        home.write(".local/share/opencode/storage/message/s/m.json", #"{"id":"m","role":"assistant","modelID":"x","time":{"created":1e300},"tokens":{"input":1e300}}"#)
        // Counts that fit a 64-bit integer alone but not added up.
        home.write(".gemini/tmp/p/chats/session-2.jsonl", #"{"id":"g2","timestamp":"2026-10-30T09:00:00Z","type":"gemini","model":"gemini-2.5-pro","tokens":{"input":1,"output":5000000000000000000,"thoughts":5000000000000000000}}"# + "\n")
        home.write(".qwen/projects/p/chats/s.jsonl", #"{"uuid":"q","sessionId":"s","timestamp":"2026-10-30T09:00:00Z","type":"assistant","model":"m","usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":5000000000000000000,"thoughtsTokenCount":5000000000000000000}}"# + "\n")
        home.write(".codex/sessions/2026/10/30/rollout-y.jsonl", lines([
            ["timestamp": "2026-10-30T09:00:00.000Z", "type": "event_msg",
             "payload": ["type": "token_count", "info": ["total_token_usage": ["input_tokens": 5e18, "cached_input_tokens": -5e18, "output_tokens": 1]]]],
        ]))
        let scanner = UsageScanner(home: home.path, ledgerURL: nil)
        let result = scanner.refresh(pricer: Pricer(list: .builtIn), now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc)
        XCTAssertGreaterThanOrEqual(result.summary.monthRequests, 1)
        XCTAssertTrue(result.summary.monthCost.isFinite)
        XCTAssertNil(Timestamp.fromEpoch(1e300))
        XCTAssertNil(Timestamp.parse("9999-12-31T23:59:59Z"))
        XCTAssertEqual(JSON.int(1e300), 0)
        XCTAssertEqual(JSON.int(5e18), 0)
        XCTAssertEqual(JSON.int(-5), 0)
        XCTAssertEqual(JSON.int(1234), 1234)
        XCTAssertEqual(JSON.int("1234"), 1234)
        XCTAssertEqual(Tokens(input: .max).input, Tokens.ceiling)
        XCTAssertEqual((Tokens(input: .max - 1) + Tokens(input: .max - 1)).input, 2 * Tokens.ceiling)
    }
}
