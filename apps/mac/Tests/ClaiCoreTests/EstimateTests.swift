import Foundation
import XCTest
@testable import ClaiCore

/// A made-up week on a plan where 1% of the weekly limit is worth `rate` dollars at API prices.
/// Claude Code on this Mac logs every request; Claude Code shows the weekly limit after each one,
/// with one decimal; claude.ai and cloud sessions move the limit without any log.
struct PlanWeek {
    let rate: Double
    let resets: Double
    var decimals = 10.0
    var readings: [LimitReading] = []
    var local: [(time: Double, cost: Double)] = []
    /// All use in the week so far, and the part beyond this Mac.
    var spent = 0.0
    var cloud = 0.0

    init(rate: Double = 5, start: String = "2026-10-26T00:00:00Z") {
        self.rate = rate
        resets = Timestamp.parse(start)! + 7 * 86_400
    }

    var start: Double { resets - 7 * 86_400 }

    /// A Claude Code session in Terminal: `requests` requests of `cost` dollars, three minutes
    /// apart, from `hour` hours into the week; `parallel` dollars of cloud use spread over it.
    mutating func session(hour: Double, requests: Int, cost: Double = 1, parallel: Double = 0) {
        for k in 0..<requests {
            let time = start + hour * 3600 + Double(k) * 180
            local.append((time, cost))
            spent += cost + parallel / Double(requests)
            cloud += parallel / Double(requests)
            readings.append(LimitReading(time: time, weekUsed: (spent / rate * decimals).rounded() / decimals, weekResets: resets))
        }
    }

    /// Use on claude.ai or in a cloud session, with no reading until Claude Code runs again.
    mutating func elsewhere(_ dollars: Double) {
        spent += dollars
        cloud += dollars
    }

    func estimate(now: Double? = nil) -> ClaudeEstimate? {
        let at = now ?? (readings.last!.time + 60)
        return ClaudeEstimator.estimate(readings: readings, local: ClaudeEstimator.Local(local), since: start - 86_400, now: at)
    }
}

final class ClaudeEstimateTests: XCTestCase {
    func testMeasuresTheRateOnLocalUseAndEstimatesTheRest() throws {
        var week = PlanWeek(rate: 5)
        week.session(hour: 9, requests: 30)
        week.elsewhere(40)
        week.session(hour: 33, requests: 30)
        week.elsewhere(25)
        week.session(hour: 57, requests: 30)
        let estimate = try XCTUnwrap(week.estimate())
        XCTAssertEqual(try XCTUnwrap(estimate.dollarsPerPoint), 5, accuracy: 0.01)
        XCTAssertGreaterThanOrEqual(estimate.stretches, 3)
        let current = try XCTUnwrap(estimate.week)
        XCTAssertEqual(current.local, 90, accuracy: 0.001)
        XCTAssertEqual(current.beyond, 65, accuracy: 0.6, "the use on claude.ai and in the cloud")
        XCTAssertEqual(current.total, 155, accuracy: 0.6)
        XCTAssertEqual(current.used, 31, accuracy: 0.05)
        XCTAssertEqual(estimate.beyond.map(\.dollars).reduce(0, +), current.beyond, accuracy: 1e-9)
        // The cloud use shows up when Claude Code next runs: at the first reading of each session.
        let firstOfSessions = Set([33.0, 57.0].map { week.start + $0 * 3600 })
        let bigMoments = estimate.beyond.filter { $0.dollars > 5 }
        XCTAssertEqual(Set(bigMoments.map(\.time)), firstOfSessions)
    }

    func testCloudUseDuringASessionLowersOnlyThatStretch() throws {
        var week = PlanWeek(rate: 5)
        week.session(hour: 9, requests: 30)
        week.session(hour: 33, requests: 30)
        week.session(hour: 57, requests: 30, parallel: 30)
        week.session(hour: 81, requests: 30)
        let estimate = try XCTUnwrap(week.estimate())
        XCTAssertEqual(try XCTUnwrap(estimate.dollarsPerPoint), 5, accuracy: 0.01, "the stretches without other use set the rate")
        XCTAssertEqual(try XCTUnwrap(estimate.week).beyond, 30, accuracy: 1)
    }

    func testMeasuresBeforeItEstimates() throws {
        var week = PlanWeek(rate: 5)
        week.session(hour: 9, requests: 12)
        let measuring = try XCTUnwrap(week.estimate())
        XCTAssertNil(measuring.dollarsPerPoint)
        XCTAssertFalse(measuring.isReady)
        XCTAssertNil(measuring.week)
        XCTAssertTrue(measuring.beyond.isEmpty)
        XCTAssertNil(ClaudeEstimator.estimate(readings: [], local: ClaudeEstimator.Local([]), since: 0, now: week.start))
    }

    func testWholePercentsNeedLongerStretches() throws {
        var whole = PlanWeek(rate: 5)
        for hour in [9.0, 33, 57, 81] { whole.session(hour: hour, requests: 60) }
        whole.readings = whole.readings.map { LimitReading(time: $0.time, weekUsed: $0.weekUsed.rounded(.down), weekResets: $0.weekResets) }
        let estimate = try XCTUnwrap(whole.estimate())
        XCTAssertEqual(try XCTUnwrap(estimate.dollarsPerPoint), 5, accuracy: 0.25, "five-point stretches keep whole percents close")
        XCTAssertGreaterThanOrEqual(estimate.stretches, 3)
    }

    func testAWeekThatResetIsNotTheCurrentWeek() throws {
        var week = PlanWeek(rate: 5)
        for hour in [9.0, 33, 57] { week.session(hour: hour, requests: 30) }
        week.elsewhere(20)
        week.session(hour: 80, requests: 2)
        let afterReset = week.resets + 3600
        let estimate = try XCTUnwrap(week.estimate(now: afterReset))
        XCTAssertNil(estimate.week)
        XCTAssertEqual(estimate.beyond.map(\.dollars).reduce(0, +), 20, accuracy: 0.6, "what that week used beyond this Mac stays counted")
    }

    func testDaysAndMonth() throws {
        var week = PlanWeek(rate: 5, start: "2026-10-26T00:00:00Z")
        week.session(hour: 9, requests: 30)
        week.elsewhere(40)
        week.session(hour: 33, requests: 30)
        week.session(hour: 57, requests: 30)
        // Into November: Oct 31 is hour 120, Nov 1 is hour 144.
        week.elsewhere(15)
        week.session(hour: 150, requests: 5)
        let now = week.start + 151 * 3600
        var days = DayResolver(timeZone: utc)
        let estimate = try XCTUnwrap(week.estimate(now: now)).withDays(now: now, days: &days)
        XCTAssertEqual(estimate.todayBeyond, 15, accuracy: 0.6)
        XCTAssertEqual(estimate.monthBeyond, 15, accuracy: 0.6, "October's use beyond this Mac is last month's")
    }

    func testLocalCostsBetweenTwoMoments() {
        let local = ClaudeEstimator.Local([(10, 1), (20, 2), (20, 4), (30, 8), (5, .nan)])
        XCTAssertEqual(local.cost(after: 0, upTo: 100), 15)
        XCTAssertEqual(local.cost(after: 10, upTo: 20), 6, "after the start, up to and including the end")
        XCTAssertEqual(local.cost(after: 20, upTo: 29), 0)
        XCTAssertEqual(local.cost(after: 30, upTo: 10), 0)
    }

    func testHistoryAppendsLoadsAndTrims() throws {
        let home = TempHome()
        let url = home.url.appendingPathComponent("clai/claude-limits-history.jsonl")
        let now = Timestamp.parse("2026-11-04T12:00:00Z")!
        LimitHistory.append(LimitReading(time: now - 70 * 86_400, weekUsed: 10, weekResets: now - 66 * 86_400), to: url)
        LimitHistory.append(LimitReading(time: now - 3600, weekUsed: 20.5, weekResets: now + 86_400), to: url)
        home.append("clai/claude-limits-history.jsonl", "{broken\n")
        LimitHistory.append(LimitReading(time: now - 60, weekUsed: 21, weekResets: now + 86_400), to: url)
        XCTAssertEqual(LimitHistory.load(from: url).map(\.weekUsed), [10, 20.5, 21])
        XCTAssertEqual(LimitHistory.load(from: url, since: now - 7200).map(\.weekUsed), [20.5, 21])
        LimitHistory.trim(url, now: now)
        XCTAssertEqual(LimitHistory.load(from: url).map(\.weekUsed), [20.5, 21])
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8).split(separator: "\n").count, 2)
    }

    func testTheStatusLineRecordsEachMoveOfTheWeek() throws {
        let home = TempHome()
        let folder = home.url.appendingPathComponent("clai")
        let history = folder.appendingPathComponent("claude-limits-history.jsonl")
        func run(_ five: Double, _ week: Double, at time: Double) {
            _ = StatusLineRunner.run(input: ClaudeLimitsTests.statusLine(five: five, week: week),
                                     limitsURL: folder.appendingPathComponent("claude-limits.json"),
                                     installedURL: folder.appendingPathComponent("claude-status-line.json"),
                                     historyURL: history, now: time)
        }
        run(10, 41.2, at: 1_793_740_000)
        run(12, 41.2, at: 1_793_740_060)
        run(13, 41.5, at: 1_793_740_120)
        let readings = LimitHistory.load(from: history)
        XCTAssertEqual(readings.map(\.weekUsed), [41.2, 41.5], "a move of the 5-hour window alone adds nothing")
        XCTAssertEqual(readings.first?.weekResets, 1_794_200_000)
    }

    func testScannerAddsTheEstimateToTheSummary() throws {
        let home = TempHome()
        var week = PlanWeek(rate: 0.5, start: "2026-10-26T00:00:00Z")
        var transcript: [[String: Any]] = []
        for hour in [9.0, 33, 57] {
            week.session(hour: hour, requests: 30, cost: 0)
        }
        // Each logged request: 100k uncached input tokens of Opus 4.6 ($5/M) = $0.50.
        for (index, request) in week.local.enumerated() {
            transcript.append(Fixture.claude(id: "msg_\(index)", request: "req_\(index)", time: OrgUsage.iso(request.time),
                                             input: 100_000, output: 0, read: 0, write5m: 0))
        }
        home.write(".claude/projects/p/s.jsonl", lines(transcript))
        // The readings, as if each request had cost $0.50 and 1% were worth $0.50.
        let history = home.url.appendingPathComponent("support/claude-limits-history.jsonl")
        for (index, request) in week.local.enumerated() {
            LimitHistory.append(LimitReading(time: request.time, weekUsed: Double(index + 1) + (request.time > week.start + 40 * 3600 ? 10 : 0),
                                             weekResets: week.resets), to: history)
        }
        let scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil, limitsHistoryURL: history)
        let now = Date(timeIntervalSince1970: week.start + 80 * 3600)
        let estimate = try XCTUnwrap(scanner.refresh(pricer: Pricer(list: .builtIn), now: now, timeZone: utc).summary.claudeEstimate)
        XCTAssertEqual(try XCTUnwrap(estimate.dollarsPerPoint), 0.5, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(estimate.week).beyond, 5, accuracy: 0.01, "ten points beyond this Mac, at $0.50 each")
        XCTAssertNil(UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil)
            .refresh(pricer: Pricer(list: .builtIn), now: now, timeZone: utc).summary.claudeEstimate)
    }
}
