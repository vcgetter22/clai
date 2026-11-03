import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import ClaiCore

/// Pages of Anthropic's usage report, in the shape the API reference documents.
enum ReportFixture {
    static func row(_ start: String, product: String?, model: String?, window: String? = "0-200k", speed: String? = "standard",
                    input: Int = 100, output: Int = 2_000, read: Int = 50_000, write5m: Int = 3_000, write1h: Int = 0,
                    requests: Int? = 10, searches: Int = 0, email: String? = nil) -> [String: Any] {
        var group: [String: Any] = [
            "model": model ?? NSNull(), "product": product ?? NSNull(), "context_window": window ?? NSNull(), "speed": speed ?? NSNull(),
            "workspace_id": NSNull(), "api_key_id": NSNull(), "service_tier": NSNull(),
        ]
        if let email {
            group["actor"] = ["type": "user_actor", "user_id": "user_01", "email_address": email, "name": "Someone", "deleted": false]
        }
        let start = Timestamp.parse(start)!
        return [
            "starting_at": OrgUsage.iso(start),
            "ending_at": OrgUsage.iso(start + 3600),
            "group": group,
            "usage": [
                "uncached_input_tokens": input, "output_tokens": output, "cache_read_input_tokens": read,
                "cache_creation": ["ephemeral_5m_input_tokens": write5m, "ephemeral_1h_input_tokens": write1h],
                "server_tool_use": ["web_search_requests": searches],
                "total_tokens": input + output + read + write5m + write1h,
                "requests": requests ?? NSNull(),
            ] as [String: Any],
        ]
    }

    static func page(_ rows: [[String: Any]], next: String? = nil, refreshed: String? = "2026-10-30T08:00:00Z") -> Data {
        let object: [String: Any] = ["data": rows, "has_more": next != nil, "next_page": next ?? NSNull(), "data_refreshed_at": refreshed ?? NSNull()]
        return try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}

/// Answers requests from a table of pages and records them.
final class FakeReport: @unchecked Sendable {
    var requests: [URLRequest] = []
    var answer: (URLComponents) -> (Data, Int)
    private let lock = NSLock()

    init(_ answer: @escaping (URLComponents) -> (Data, Int)) { self.answer = answer }

    var transport: OrgUsageClient.Transport {
        { request in self.record(request) }
    }

    private func record(_ request: URLRequest) -> (Data, Int) {
        lock.lock()
        defer { lock.unlock() }
        requests.append(request)
        return answer(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!)
    }
}

extension URLComponents {
    func value(_ name: String) -> String? { queryItems?.first { $0.name == name }?.value }
}

final class OrgUsageQueryTests: XCTestCase {
    func testAsksForHourlyUsageByModelAndProduct() {
        let start = Timestamp.parse("2026-10-01T00:00:00Z")!
        let query = OrgUsageQuery(start: start, end: start + 86_400, actorId: "user_01", page: "page_2/x+y")
        let url = query.url.absoluteString
        XCTAssertTrue(url.hasPrefix("https://api.anthropic.com/v1/organizations/analytics/usage?"))
        XCTAssertTrue(url.contains("starting_at=2026-10-01T00%3A00%3A00Z&ending_at=2026-10-02T00%3A00%3A00Z&time_bucket_width=1h"))
        for dimension in ["model", "product", "context_window", "speed"] {
            XCTAssertTrue(url.contains("group_by%5B%5D=" + dimension), dimension)
        }
        XCTAssertTrue(url.contains("actor_ids%5B%5D=user_01"))
        XCTAssertTrue(url.contains("order_by=time&order=asc&limit=1000"))
        XCTAssertTrue(url.hasSuffix("page=page_2%2Fx%2By"))
        XCTAssertFalse(OrgUsageQuery(start: start, end: start + 3600).url.absoluteString.contains("actor"))
        let people = OrgUsageQuery(start: start, end: start + 3600, actors: true).url.absoluteString
        XCTAssertTrue(people.contains("group_by%5B%5D=actor&limit=1000"))
        XCTAssertFalse(people.contains("time_bucket_width"))

        let request = query.request(key: "sk-ant-admin01-test", userAgent: "clai/1.1.0 (Mac)")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), "sk-ant-admin01-test")
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-beta"), "analytics-usage-cost-2026-08-24")
        XCTAssertEqual(request.httpMethod ?? "GET", "GET")
    }

    func testIsoTimes() {
        XCTAssertEqual(OrgUsage.iso(Timestamp.parse("2026-02-28T23:15:07Z")!), "2026-02-28T23:15:07Z")
        XCTAssertEqual(OrgUsage.iso(OrgUsage.earliest), "2026-01-01T00:00:00Z")
    }
}

final class OrgUsagePageTests: XCTestCase {
    func testReadsTokensFlagsAndProducts() throws {
        let data = ReportFixture.page([
            ReportFixture.row("2026-10-29T10:00:00Z", product: "claude_code", model: "claude-opus-5-5", requests: 12),
            ReportFixture.row("2026-10-29T10:00:00Z", product: "chat", model: "claude-sonnet-5-5", window: "200k-1M", speed: nil, write1h: 400, searches: 3),
            ReportFixture.row("2026-10-29T11:00:00Z", product: "messages_api", model: "claude-haiku-5-5", speed: "fast"),
            // Code-execution time: no model, no tokens.
            ReportFixture.row("2026-10-29T11:00:00Z", product: nil, model: nil, input: 0, output: 0, read: 0, write5m: 0, requests: 7),
        ], next: "page_2", refreshed: "2026-10-30T08:12:00Z")
        let page = try OrgUsagePage.parse(data)
        XCTAssertEqual(page.rows.count, 3)
        XCTAssertTrue(page.hasMore)
        XCTAssertEqual(page.nextPage, "page_2")
        XCTAssertEqual(page.refreshedAt, Timestamp.parse("2026-10-30T08:12:00Z"))

        let code = page.rows[0]
        XCTAssertEqual(code.hour, Int32(Timestamp.parse("2026-10-29T10:00:00Z")! / 3600))
        XCTAssertEqual(code.product, "claude_code")
        XCTAssertEqual(code.requests, 12)
        XCTAssertEqual(code.tokens, Tokens(input: 100, output: 2_000, cacheRead: 50_000, cacheWrite: 3_000))
        XCTAssertFalse(code.long)
        XCTAssertFalse(code.fast)

        let chat = page.rows[1]
        XCTAssertTrue(chat.long)
        XCTAssertEqual(chat.tokens.cacheWrite1h, 400)
        XCTAssertEqual(chat.webSearches, 3)
        XCTAssertTrue(page.rows[2].fast)
    }

    func testMergesRowsOfTheSameHourProductAndModel() throws {
        let data = ReportFixture.page([
            ReportFixture.row("2026-10-29T10:00:00Z", product: "chat", model: "claude-sonnet-5-5", requests: 4),
            ReportFixture.row("2026-10-29T10:00:00Z", product: "chat", model: "claude-sonnet-5-5", requests: 9),
            ReportFixture.row("2026-10-29T10:00:00Z", product: "messages_api", model: "claude-sonnet-5-5", requests: 5),
        ])
        XCTAssertEqual(try OrgUsagePage.parse(data).rows.map(\.requests), [13, 5])
    }

    func testFindsAPersonByAddress() throws {
        let data = ReportFixture.page([
            ReportFixture.row("2026-10-01T00:00:00Z", product: nil, model: nil, email: "colleague@example.com"),
            ReportFixture.row("2026-10-01T00:00:00Z", product: nil, model: nil, email: "Me@Example.com"),
        ], next: "p2")
        let page = try OrgActorsPage.parse(data, email: " me@example.com ")
        XCTAssertEqual(page.userId, "user_01")
        XCTAssertTrue(page.hasMore)
        XCTAssertNil(try OrgActorsPage.parse(data, email: "someone@else.com").userId)
    }

    func testRejectsWhatIsNotAPage() {
        XCTAssertThrowsError(try OrgUsagePage.parse(Data("{\"type\":\"error\"}".utf8)))
        XCTAssertThrowsError(try OrgUsagePage.parse(Data("not json".utf8)))
        XCTAssertEqual(try OrgUsagePage.parse(ReportFixture.page([], refreshed: nil)).rows, [])
    }

    func testErrorsSayWhatToDo() {
        let body = Data(#"{"type":"error","error":{"type":"permission_error","message":"Key lacks read:analytics"}}"#.utf8)
        let forbidden = OrgUsageError.from(status: 403, body: body)
        XCTAssertEqual(forbidden, .rejected(status: 403, message: "Key lacks read:analytics"))
        XCTAssertTrue(forbidden.isKeyProblem)
        XCTAssertTrue(forbidden.message.contains("Admin API key"))
        XCTAssertTrue(forbidden.message.contains("Key lacks read:analytics"))
        XCTAssertEqual(OrgUsageError.from(status: 429, body: Data()), .unavailable(status: 429))
        XCTAssertEqual(OrgUsageError.from(status: 502, body: Data()), .unavailable(status: 502))
        XCTAssertFalse(OrgUsageError.unavailable(status: 502).isKeyProblem)
    }
}

final class OrgUsageClientTests: XCTestCase {
    let now = Timestamp.parse("2026-10-30T12:34:00Z")!

    func testFollowsPagesAndSplitsLongRanges() async throws {
        let fake = FakeReport { query in
            let start = query.value("starting_at")!
            switch query.value("page") {
            case nil:
                return (ReportFixture.page([ReportFixture.row(start, product: "chat", model: "claude-sonnet-5-5", requests: 1)], next: "p2"), 200)
            case "p2":
                return (ReportFixture.page([ReportFixture.row(start, product: "chat", model: "claude-sonnet-5-5", requests: 2),
                                            ReportFixture.row(start, product: "claude_code", model: "claude-opus-5-5", requests: 3)],
                                           refreshed: "2026-10-30T09:00:00Z"), 200)
            default:
                return (Data(), 500)
            }
        }
        let client = OrgUsageClient(key: "k", userAgent: "clai-test", transport: fake.transport)
        let result = try await client.usage(from: now - 40 * 86_400, to: now, now: now)
        // 40 days: two windows of at most 31 days, two pages each.
        XCTAssertEqual(fake.requests.count, 4)
        let windows = fake.requests.compactMap { URLComponents(url: $0.url!, resolvingAgainstBaseURL: false) }.filter { $0.value("page") == nil }
        XCTAssertEqual(windows.map { $0.value("starting_at")! }, ["2026-09-20T12:00:00Z", "2026-10-21T12:00:00Z"])
        XCTAssertEqual(windows.map { $0.value("ending_at")! }, ["2026-10-21T12:00:00Z", "2026-10-30T12:00:00Z"])
        XCTAssertEqual(result.rows.count, 4)
        XCTAssertEqual(result.rows.filter { $0.product == "chat" }.map(\.requests), [3, 3], "both pages of a window add up")
        XCTAssertEqual(result.refreshedAt, Timestamp.parse("2026-10-30T09:00:00Z"))
    }

    func testRereadsAWindowWhenTheCursorExpires() async throws {
        var expired = false
        let fake = FakeReport { query in
            let start = query.value("starting_at")!
            if query.value("page") == "p2" && !expired {
                expired = true
                return (Data(#"{"type":"error","error":{"message":"cursor expired"}}"#.utf8), 410)
            }
            if query.value("page") == nil {
                return (ReportFixture.page([ReportFixture.row(start, product: "chat", model: "claude-sonnet-5-5", requests: 1)], next: "p2"), 200)
            }
            return (ReportFixture.page([ReportFixture.row(start, product: "cowork", model: "claude-sonnet-5-5", requests: 2)]), 200)
        }
        let client = OrgUsageClient(key: "k", userAgent: "clai-test", transport: fake.transport)
        let result = try await client.usage(from: now - 86_400, to: now, now: now)
        XCTAssertEqual(fake.requests.count, 4)
        XCTAssertEqual(result.rows.map(\.requests), [1, 2], "the first read of the window is not counted twice")
    }

    func testCountsOnePersonWithTheirUserId() async throws {
        let fake = FakeReport { query in
            if query.value("group_by[]") == "actor" {
                // The people of the organization, two pages.
                if query.value("page") == nil {
                    return (ReportFixture.page([ReportFixture.row("2026-10-01T00:00:00Z", product: nil, model: nil, email: "a@example.com")], next: "p2"), 200)
                }
                return (ReportFixture.page([ReportFixture.row("2026-10-01T00:00:00Z", product: nil, model: nil, email: "me@example.com")]), 200)
            }
            XCTAssertEqual(query.value("actor_ids[]"), "user_01")
            return (ReportFixture.page([ReportFixture.row(query.value("starting_at")!, product: "chat", model: "claude-sonnet-5-5", requests: 2)]), 200)
        }
        let client = OrgUsageClient(key: "k", userAgent: "clai-test", transport: fake.transport)
        let result = try await client.usage(from: now - 86_400, to: now, onlyEmail: "Me@example.com", now: now)
        XCTAssertEqual(result.rows.map(\.requests), [2])
        XCTAssertEqual(fake.requests.count, 3)
        let lookup = URLComponents(url: fake.requests[0].url!, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(lookup.value("starting_at"), "2026-09-29T12:00:00Z", "the last 31 days")

        do {
            _ = try await client.usage(from: now - 86_400, to: now, onlyEmail: "nobody@example.com", now: now)
            XCTFail("expected an error")
        } catch let error as OrgUsageError {
            XCTAssertEqual(error, .personNotFound("nobody@example.com"))
        }
    }

    func testStopsAtTheFirstError() async {
        let fake = FakeReport { _ in (Data(#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#.utf8), 401) }
        let client = OrgUsageClient(key: "bad", userAgent: "clai-test", transport: fake.transport)
        do {
            _ = try await client.usage(from: now - 40 * 86_400, to: now, now: now)
            XCTFail("expected an error")
        } catch let error as OrgUsageError {
            XCTAssertEqual(error, .rejected(status: 401, message: "invalid x-api-key"))
            XCTAssertTrue(error.message.hasPrefix("Anthropic did not accept this key."))
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(fake.requests.count, 1)
    }

    func testNeverAsksForMoreThanTheReportHas() async throws {
        let fake = FakeReport { _ in (ReportFixture.page([]), 200) }
        let client = OrgUsageClient(key: "k", userAgent: "clai-test", transport: fake.transport)
        _ = try await client.usage(from: 0, to: now + 86_400, now: now)
        let first = URLComponents(url: fake.requests[0].url!, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(first.value("starting_at"), "2026-01-01T00:00:00Z", "the report starts on 2026-01-01")
        let last = URLComponents(url: fake.requests.last!.url!, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(last.value("ending_at"), "2026-10-30T12:00:00Z", "never past now")
    }
}

final class OrgUsageStoreTests: XCTestCase {
    let pricer = Pricer(list: .builtIn)

    func hour(_ text: String) -> Int32 { Int32(Timestamp.parse(text)! / 3600) }

    func testReplacesTheHoursItReadAndKeepsTheRest() throws {
        var store = OrgUsageStore()
        let old = [
            OrgRow(hour: hour("2026-10-01T10:00:00Z"), product: "chat", model: "claude-sonnet-5-5", requests: 1, tokens: Tokens(output: 10)),
            OrgRow(hour: hour("2026-10-29T10:00:00Z"), product: "chat", model: "claude-sonnet-5-5", requests: 1, tokens: Tokens(output: 10)),
        ]
        store.replace(from: Timestamp.parse("2026-09-30T00:00:00Z")!, to: Timestamp.parse("2026-10-30T12:00:00Z")!, with: old,
                      refreshedAt: 1, at: 100, full: true)
        let fresh = [OrgRow(hour: hour("2026-10-29T10:00:00Z"), product: "chat", model: "claude-sonnet-5-5", requests: 5, tokens: Tokens(output: 50))]
        store.replace(from: Timestamp.parse("2026-10-27T12:30:00Z")!, to: Timestamp.parse("2026-10-30T12:30:00Z")!, with: fresh,
                      refreshedAt: 2, at: 200, full: false)
        XCTAssertEqual(store.rows.map(\.requests), [1, 5])
        XCTAssertEqual(store.refreshedAt, 2)
        XCTAssertEqual(store.fetchedAt, 200)
        XCTAssertEqual(store.fullyFetchedAt, 100)

        let home = TempHome()
        let url = home.url.appendingPathComponent("cloud.json")
        try store.save(to: url)
        XCTAssertEqual(OrgUsageStore.load(from: url), store)
        home.write("broken.json", "{")
        XCTAssertTrue(OrgUsageStore.load(from: home.url.appendingPathComponent("broken.json")).isEmpty)
    }

    func testReadsAllOfLastMonthTwiceADay() {
        let now = Timestamp.parse("2026-11-03T22:00:00Z")!
        let first = OrgUsageStore().nextRange(now: now)
        XCTAssertTrue(first.full)
        XCTAssertEqual(OrgUsage.iso(first.start), "2026-09-30T00:00:00Z")
        var store = OrgUsageStore()
        store.replace(from: first.start, to: now, with: [], refreshedAt: nil, at: now, full: true)
        let next = store.nextRange(now: now + 3600)
        XCTAssertFalse(next.full)
        XCTAssertEqual(next.start, now + 3600 - 3 * 86_400)
        XCTAssertTrue(store.nextRange(now: now + 13 * 3600).full)
        XCTAssertEqual(OrgUsage.iso(OrgUsageStore().nextRange(now: Timestamp.parse("2026-01-15T00:00:00Z")!).start), "2025-11-30T00:00:00Z")
    }

    func testCloudProductsBecomeCloudTools() {
        let h = hour("2026-10-29T10:00:00Z")
        let store = OrgUsageStore(rows: [
            OrgRow(hour: h, product: "chat", model: "claude-sonnet-5-5", requests: 2, tokens: Tokens(output: 100)),
            OrgRow(hour: h, product: "claude_design", model: "claude-opus-5-5", requests: 1, tokens: Tokens(output: 100)),
            OrgRow(hour: h, product: "messages_api", model: "claude-haiku-5-5", long: true, requests: 3, tokens: Tokens(output: 100)),
            OrgRow(hour: h, product: "message_batches_api", model: "claude-haiku-5-5", requests: 4, tokens: Tokens(output: 100)),
            OrgRow(hour: h, product: "claude_code", model: "claude-opus-5-5", fast: true, requests: 5, tokens: Tokens(output: 100)),
            OrgRow(hour: h, product: "cowork", model: "claude-opus-5-5", requests: 6, tokens: Tokens(output: 100)),
        ])
        let lines = store.derived(local: Ledger())
        func requests(_ tool: Tool) -> Int { lines.filter { $0.key.tool == tool }.map(\.value.requests).reduce(0, +) }
        XCTAssertEqual(requests(.claudeApps), 3)
        XCTAssertEqual(requests(.claudeAPI), 7)
        XCTAssertEqual(requests(.claudeCodeCloud), 5)
        XCTAssertEqual(requests(.coworkCloud), 6)
        XCTAssertEqual(lines.keys.filter(\.batch).map(\.model), ["claude-haiku-5-5"])
        XCTAssertEqual(lines.keys.filter(\.long).map(\.tool), [.claudeAPI])
        XCTAssertEqual(lines.keys.filter(\.fast).map(\.tool), [.claudeCodeCloud])
        XCTAssertTrue(lines.keys.allSatisfy { $0.quarter == Quarter(time: Double(h) * 3600) })
    }

    /// The report counts this Mac's Claude Code sessions too when they belong to the organization:
    /// only what goes beyond the logs is cloud usage.
    func testClaudeCodeOnThisMacIsNotCountedTwice() {
        let day = "2026-10-29T"
        var local: [BucketKey: BucketValue] = [:]
        // 8 requests logged on this Mac that day, one of them near the turn of an hour.
        local[BucketKey(quarter: Quarter(time: Timestamp.parse(day + "09:45:00Z")!), tool: .claudeCode, model: "claude-opus-5-5-20261001")] =
            BucketValue(tokens: Tokens(input: 70, output: 700, cacheRead: 7_000), requests: 7)
        local[BucketKey(quarter: Quarter(time: Timestamp.parse(day + "10:59:00Z")!), tool: .claudeCode, model: "claude-opus-5-5")] =
            BucketValue(tokens: Tokens(input: 10, output: 100, cacheRead: 1_000), requests: 1)
        // Another model and Codex do not matter.
        local[BucketKey(quarter: Quarter(time: Timestamp.parse(day + "10:00:00Z")!), tool: .claudeCode, model: "claude-haiku-5-5")] =
            BucketValue(tokens: Tokens(output: 1_000_000), requests: 100)
        local[BucketKey(quarter: Quarter(time: Timestamp.parse(day + "10:00:00Z")!), tool: .codex, model: "claude-opus-5-5")] =
            BucketValue(tokens: Tokens(output: 1_000_000), requests: 100)
        let ledger = Ledger(buckets: local)

        // The report: the same 8 requests (the one at 10:59 placed in the 11:00 hour) and 4 cloud ones.
        let store = OrgUsageStore(rows: [
            OrgRow(hour: hour(day + "09:00:00Z"), product: "claude_code", model: "claude-opus-5-5", requests: 7, tokens: Tokens(input: 70, output: 700, cacheRead: 7_000)),
            OrgRow(hour: hour(day + "11:00:00Z"), product: "claude_code", model: "claude-opus-5-5", requests: 1, tokens: Tokens(input: 10, output: 100, cacheRead: 1_000)),
            OrgRow(hour: hour(day + "15:00:00Z"), product: "claude_code", model: "claude-opus-5-5", requests: 4, tokens: Tokens(input: 40, output: 4_000, cacheRead: 40_000)),
            OrgRow(hour: hour(day + "15:00:00Z"), product: "chat", model: "claude-opus-5-5", requests: 2, tokens: Tokens(output: 300)),
        ])
        let lines = store.derived(local: ledger)
        let cloudCode = lines.filter { $0.key.tool == .claudeCodeCloud }.map(\.value)
        let requests = cloudCode.map(\.requests).reduce(0, +)
        let tokens = cloudCode.map(\.tokens).reduce(Tokens.zero, +)
        XCTAssertEqual(requests, 4)
        XCTAssertEqual(tokens.input, 40)
        XCTAssertEqual(tokens.output, 4_000)
        XCTAssertEqual(tokens.cacheRead, 40_000)
        let hours = Set(lines.filter { $0.key.tool == .claudeCodeCloud }.map { OrgUsage.iso($0.key.quarter.start) })
        XCTAssertEqual(hours, ["2026-10-29T15:00:00Z"], "the cloud requests are where the report has more than the logs")
        XCTAssertEqual(lines.filter { $0.key.tool == .claudeApps }.map(\.value.requests), [2], "chat has no local log to subtract")

        // Nothing logged on this Mac belongs to the organization: the report counts in full.
        let elsewhere = store.derived(local: Ledger())
        XCTAssertEqual(elsewhere.filter { $0.key.tool == .claudeCodeCloud }.map(\.value.requests).reduce(0, +), 12)
        // More in the logs than in the report: nothing is left, never less than nothing.
        let all = OrgUsageStore(rows: [store.rows[2]]).derived(local: Ledger(buckets: [
            BucketKey(quarter: Quarter(time: Timestamp.parse(day + "16:00:00Z")!), tool: .claudeCode, model: "claude-opus-5-5"):
                BucketValue(tokens: Tokens(input: 999, output: 99_999, cacheRead: 999_999), requests: 50),
        ]))
        XCTAssertTrue(all.isEmpty)
    }

    func testSummaryPricesCloudUsage() {
        let pricer = Pricer(list: .builtIn)
        let h = hour("2026-10-29T10:00:00Z")
        let tokens = Tokens(input: 1_000_000, output: 1_000_000)
        let store = OrgUsageStore(rows: [
            OrgRow(hour: h, product: "messages_api", model: "claude-sonnet-5-5", requests: 1, tokens: tokens),
            OrgRow(hour: h, product: "message_batches_api", model: "claude-sonnet-5-5", requests: 1, tokens: tokens),
        ])
        var local: [BucketKey: BucketValue] = [:]
        local[BucketKey(quarter: Quarter(time: Double(h) * 3600), tool: .claudeCode, model: "claude-sonnet-5-5")] = BucketValue(tokens: tokens, requests: 1)
        let ledger = Ledger(buckets: local)
        var days = DayResolver(timeZone: utc)
        let summary = Summary.make(ledger: ledger.adding(store.derived(local: ledger)), pricer: pricer,
                                   now: Timestamp.parse("2026-10-30T12:00:00Z")!, days: &days)
        let standard = pricer.match("claude-sonnet-5-5")!.price(on: Day(year: 2026, month: 10, day: 29)).cost(of: tokens, long: false, fast: false)
        let api = summary.tools.first { $0.tool == .claudeAPI }!
        XCTAssertEqual(api.cost, standard * 1.5, accuracy: 1e-9, "a batch request costs half")
        XCTAssertEqual(api.requests, 2)
        XCTAssertEqual(summary.monthCost, standard * 2.5, accuracy: 1e-9)
        XCTAssertEqual(summary.vendorMonthCost[.anthropic]!, standard, accuracy: 1e-9, "the organization's usage is not paid by a personal plan")
    }

    func testScannerAddsTheReport() throws {
        let home = TempHome()
        home.write(".claude/projects/p/s.jsonl", lines([Fixture.claude(id: "msg_a", time: "2026-10-29T10:00:00.000Z")]))
        let cloudURL = home.url.appendingPathComponent("support/cloud.json")
        let scanner = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil, cloudURL: cloudURL)
        let now = Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!)
        XCTAssertEqual(scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary.tools.map(\.tool), [.claudeCode])

        scanner.updateCloud(from: now.timeIntervalSince1970 - 86_400 * 3, to: now.timeIntervalSince1970,
                            rows: [OrgRow(hour: hour("2026-10-29T14:00:00Z"), product: "chat", model: "claude-opus-5-5", requests: 3, tokens: Tokens(output: 3_000))],
                            refreshedAt: 5, at: now.timeIntervalSince1970, full: false)
        let result = scanner.refresh(pricer: pricer, now: now, timeZone: utc)
        XCTAssertEqual(Set(result.summary.tools.map(\.tool)), [.claudeCode, .claudeApps])
        XCTAssertEqual(result.summary.monthRequests, 4)
        XCTAssertEqual(result.cloudFetchedAt, now.timeIntervalSince1970)
        XCTAssertFalse(result.sources.contains { $0.tool.isCloud }, "the report is not a folder on this Mac")
        XCTAssertTrue(FileManager.default.fileExists(atPath: cloudURL.path))

        // A new scanner (the next launch) reads the stored report.
        let again = UsageScanner(home: home.path, readers: [ClaudeReader()], ledgerURL: nil, cloudURL: cloudURL)
        XCTAssertEqual(again.storedSummary(pricer: pricer, now: now, timeZone: utc).monthRequests, 3)

        scanner.clearCloud()
        XCTAssertEqual(scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary.tools.map(\.tool), [.claudeCode])
        XCTAssertFalse(FileManager.default.fileExists(atPath: cloudURL.path))
    }
}

final class ClaudeLimitsTests: XCTestCase {
    /// The status line JSON as documented (code.claude.com/docs/en/statusline), trimmed.
    static func statusLine(five: Double? = 23.5, week: Double? = 41.2) -> Data {
        var limits: [String: Any] = [:]
        if let five { limits["five_hour"] = ["used_percentage": five, "resets_at": 1_793_747_400] }
        if let week { limits["seven_day"] = ["used_percentage": week, "resets_at": 1_794_200_000] }
        let object: [String: Any] = [
            "hook_event_name": "Status", "session_id": "abc", "transcript_path": "/Users/me/.claude/projects/p/abc.jsonl",
            "cwd": "/Users/me/project", "model": ["id": "claude-opus-5-5", "display_name": "Opus"],
            "workspace": ["current_dir": "/Users/me/project", "project_dir": "/Users/me/project"],
            "version": "2.1.317", "cost": ["total_cost_usd": 0.42], "rate_limits": limits,
        ]
        return try! JSONSerialization.data(withJSONObject: object)
    }

    func testReadsTheTwoWindows() {
        let limits = ClaudeLimits.parse(statusLine: Self.statusLine(), now: 1_793_740_000)!
        XCTAssertEqual(limits.primary?.usedPercent, 23.5)
        XCTAssertEqual(limits.primary?.windowMinutes, 300)
        XCTAssertEqual(limits.primary?.resetsAt, 1_793_747_400)
        XCTAssertEqual(limits.secondary?.usedPercent, 41.2)
        XCTAssertEqual(limits.secondary?.windowMinutes, 10_080)
        XCTAssertEqual(limits.observedAt, 1_793_740_000)
        XCTAssertNil(ClaudeLimits.parse(statusLine: Self.statusLine(five: nil, week: nil), now: 0))
        XCTAssertNil(ClaudeLimits.parse(statusLine: Data(#"{"model":{"id":"x"}}"#.utf8), now: 0), "API key users have no limits")
        XCTAssertNil(ClaudeLimits.parse(statusLine: Data("garbage".utf8), now: 0))
    }

    func testAWindowLeftOutKeepsItsLastValueUntilItResets() {
        let old = ClaudeLimits.parse(statusLine: Self.statusLine(five: 10, week: 30), now: 1_793_740_000)!
        let new = ClaudeLimits.parse(statusLine: Self.statusLine(five: 50, week: nil), now: 1_793_741_000)!
        let merged = ClaudeLimits.merge(new, over: old, now: 1_793_741_000)
        XCTAssertEqual(merged.primary?.usedPercent, 50)
        XCTAssertEqual(merged.secondary?.usedPercent, 30)
        XCTAssertNil(ClaudeLimits.merge(new, over: old, now: 1_794_300_000).secondary, "the week has reset")
    }

    func testSavesAndLoads() throws {
        let home = TempHome()
        let url = home.url.appendingPathComponent("clai/claude-limits.json")
        let limits = ClaudeLimits.parse(statusLine: Self.statusLine(), now: 1_793_740_000)!
        try ClaudeLimits.save(limits, to: url)
        XCTAssertEqual(ClaudeLimits.load(from: url), limits)
        XCTAssertNil(ClaudeLimits.load(from: home.url.appendingPathComponent("none.json")))
    }
}

final class ClaudeStatusLineTests: XCTestCase {
    let command = ClaudeStatusLine.command(executable: "/Applications/clai.app/Contents/MacOS/clai")

    func testCommandQuotesThePath() {
        XCTAssertEqual(command, "'/Applications/clai.app/Contents/MacOS/clai' --status-line")
        XCTAssertEqual(ClaudeStatusLine.command(executable: "/Users/o'neil/clai.app/Contents/MacOS/clai"),
                       "'/Users/o'\\''neil/clai.app/Contents/MacOS/clai' --status-line")
        XCTAssertTrue(ClaudeStatusLine.isClai(command))
        XCTAssertFalse(ClaudeStatusLine.isClai("~/bin/statusline.sh"))
        XCTAssertFalse(ClaudeStatusLine.isClai(nil))
    }

    func testNoSettingsFile() throws {
        let (text, previous) = try ClaudeStatusLine.install(command: command, in: nil)
        XCTAssertNil(previous)
        XCTAssertEqual(ClaudeStatusLine.currentCommand(in: text), command)
        let back = try XCTUnwrap(ClaudeStatusLine.uninstall(in: text, previous: nil))
        XCTAssertEqual(ClaudeStatusLine.object(back)?.count, 0)
    }

    func testKeepsTheRestOfTheFileAsItWas() throws {
        let original = """
        {
          "model": "opus",
          "permissions": {
            "allow": ["Bash(git status)", "Read(~/notes/{a,b}.md)"]
          },
          "env": { "PATH_NOTE": "a \\"quoted\\" value, with } and ]" }
        }

        """
        let (text, previous) = try ClaudeStatusLine.install(command: command, in: original)
        XCTAssertNil(previous)
        XCTAssertEqual(ClaudeStatusLine.currentCommand(in: text), command)
        XCTAssertTrue(text.contains(#""allow": ["Bash(git status)", "Read(~/notes/{a,b}.md)"]"#))
        XCTAssertEqual(ClaudeStatusLine.object(text)?["model"] as? String, "opus")
        XCTAssertEqual(ClaudeStatusLine.uninstall(in: text, previous: nil), original, "taking it out restores the file exactly")
        XCTAssertTrue(text.hasPrefix("{\n  \"statusLine\": {"), "spaced like the file")
        let compact = #"{"model":"opus","env":{"A":"1"}}"#
        let (oneLine, _) = try ClaudeStatusLine.install(command: command, in: compact)
        XCTAssertTrue(oneLine.hasPrefix(#"{"statusLine": {"#))
        XCTAssertEqual(ClaudeStatusLine.uninstall(in: oneLine, previous: nil), compact)
    }

    func testReplacesAndRestoresTheUsersStatusLine() throws {
        let original = """
        {
          "statusLine": {
            "type": "command",
            "command": "~/.claude/statusline.sh",
            "padding": 0
          },
          "model": "opus"
        }
        """
        let (text, previous) = try ClaudeStatusLine.install(command: command, in: original)
        let setting = try XCTUnwrap(ClaudeStatusLine.object(text)?["statusLine"] as? [String: Any])
        XCTAssertEqual(setting["command"] as? String, command)
        XCTAssertEqual(setting["padding"] as? Int, 0, "other fields stay")
        let installed = ClaudeStatusLine.Installed(previous: previous, command: command)
        XCTAssertEqual(installed.previousCommand, "~/.claude/statusline.sh")
        XCTAssertEqual(ClaudeStatusLine.uninstall(in: text, previous: previous), original)

        // Installing again (clai moved) keeps clai's command in place and reports clai's as what it replaced.
        let (again, replaced) = try ClaudeStatusLine.install(command: "'/Users/me/Applications/clai.app/Contents/MacOS/clai' --status-line", in: text)
        XCTAssertTrue(ClaudeStatusLine.isClai(ClaudeStatusLine.currentCommand(in: again)))
        XCTAssertNil(ClaudeStatusLine.Installed(previous: replaced, command: command).previousCommand, "clai never runs itself")
    }

    func testConnectingTwiceRemembersTheUsersOwnCommand() throws {
        let original = #"{"statusLine": {"type": "command", "command": "~/bin/line.sh"}, "model": "opus"}"#
        let first = try ClaudeStatusLine.connect(executable: "/Applications/clai.app/Contents/MacOS/clai", settings: original, remembered: nil)
        XCTAssertEqual(first.installed.previousCommand, "~/bin/line.sh")
        // clai moved to ~/Applications: connected again from there.
        let second = try ClaudeStatusLine.connect(executable: "/Users/me/Applications/clai.app/Contents/MacOS/clai", settings: first.text,
                                                  remembered: first.installed)
        XCTAssertEqual(second.installed.previousCommand, "~/bin/line.sh")
        XCTAssertEqual(ClaudeStatusLine.currentCommand(in: second.text), "'/Users/me/Applications/clai.app/Contents/MacOS/clai' --status-line")
        XCTAssertEqual(ClaudeStatusLine.disconnect(settings: second.text, remembered: second.installed), original)
    }

    func testLeavesAStatusLineTheUserChangedSince() throws {
        let (text, _) = try ClaudeStatusLine.install(command: command, in: #"{"statusLine": {"type": "command", "command": "mine.sh"}}"#)
        let changed = text.replacingOccurrences(of: command.replacingOccurrences(of: "/", with: "\\/"), with: "theirs.sh")
            .replacingOccurrences(of: command, with: "theirs.sh")
        XCTAssertEqual(ClaudeStatusLine.currentCommand(in: changed), "theirs.sh")
        XCTAssertNil(ClaudeStatusLine.uninstall(in: changed, previous: nil))
    }

    func testRefusesWhatIsNotAnObject() {
        XCTAssertThrowsError(try ClaudeStatusLine.install(command: command, in: "[1, 2]"))
        XCTAssertThrowsError(try ClaudeStatusLine.install(command: command, in: "{ \"a\": 1, }"))
        XCTAssertThrowsError(try ClaudeStatusLine.install(command: command, in: "// comment\n{}"))
        XCTAssertNoThrow(try ClaudeStatusLine.install(command: command, in: "  \n"))
        let marked = "\u{FEFF}{\"model\": \"opus\"}"
        let (text, _) = try! ClaudeStatusLine.install(command: command, in: marked)
        XCTAssertEqual(ClaudeStatusLine.currentCommand(in: text), command)
        XCTAssertEqual(ClaudeStatusLine.uninstall(in: text, previous: nil), marked)
    }

    func testRunnerSavesLimitsAndRunsTheUsersCommand() throws {
        let home = TempHome()
        let limitsURL = home.url.appendingPathComponent("clai/claude-limits.json")
        let installedURL = home.url.appendingPathComponent("clai/claude-status-line.json")
        let input = ClaudeLimitsTests.statusLine()

        // Without a command of the user's: limits saved, nothing printed.
        let quiet = Pipe()
        XCTAssertEqual(StatusLineRunner.run(input: input, limitsURL: limitsURL, installedURL: installedURL, now: 1_793_740_000, output: quiet.fileHandleForWriting), 0)
        XCTAssertEqual(ClaudeLimits.load(from: limitsURL)?.primary?.usedPercent, 23.5)

        // With one: it gets the same input and its output is the status line.
        try ClaudeStatusLine.Installed(previous: #"{"type":"command","command":"wc -c | tr -d ' '; printf '%s' \"$X_TEST\""}"#, command: command)
            .save(to: installedURL)
        let output = Pipe()
        let status = StatusLineRunner.run(input: input, limitsURL: limitsURL, installedURL: installedURL, now: 1_793_740_000, output: output.fileHandleForWriting)
        try output.fileHandleForWriting.close()
        XCTAssertEqual(status, 0)
        let printed = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        XCTAssertEqual(printed.trimmingCharacters(in: .whitespacesAndNewlines), String(input.count))
    }
}
