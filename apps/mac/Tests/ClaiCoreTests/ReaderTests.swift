import XCTest
@testable import ClaiCore

/// Fixture lines follow the shapes the tools write; text content is replaced by placeholders.
enum Fixture {
    static func claude(id: String, request: String = "req_1", model: String = "claude-opus-4-6", time: String = "2026-10-30T10:00:00.000Z",
                       input: Int = 10, output: Int = 100, read: Int = 1000, write5m: Int = 200, write1h: Int = 0,
                       speed: String? = nil, searches: Int = 0, session: String = "s1", advisor: [String: Any]? = nil) -> [String: Any] {
        var usage: [String: Any] = [
            "input_tokens": input, "output_tokens": output, "cache_read_input_tokens": read,
            "cache_creation_input_tokens": write5m + write1h,
            "cache_creation": ["ephemeral_5m_input_tokens": write5m, "ephemeral_1h_input_tokens": write1h],
            "service_tier": "standard",
        ]
        if let speed { usage["speed"] = speed }
        if searches > 0 { usage["server_tool_use"] = ["web_search_requests": searches, "web_fetch_requests": 0] }
        if let advisor { usage["iterations"] = [["type": "message", "input_tokens": 1], advisor] }
        return [
            "parentUuid": NSNull(), "isSidechain": false, "userType": "external", "cwd": "/Users/me/project",
            "sessionId": session, "version": "2.1.0", "gitBranch": "main", "type": "assistant", "uuid": UUID().uuidString,
            "timestamp": time, "requestId": request,
            "message": ["id": id, "type": "message", "role": "assistant", "model": model,
                        "content": [["type": "text", "text": "…"]], "stop_reason": NSNull(), "usage": usage],
        ]
    }

    static func claudeUser(time: String = "2026-10-30T10:00:00.000Z") -> [String: Any] {
        ["type": "user", "timestamp": time, "message": ["role": "user", "content": "…"],
         "toolUseResult": ["usage": ["input_tokens": 999_999, "output_tokens": 999_999]]]
    }

    static func codexTurn(model: String, time: String = "2026-10-30T09:00:01.000Z") -> [String: Any] {
        ["timestamp": time, "type": "turn_context",
         "payload": ["cwd": "/Users/me/project", "approval_policy": "on-request", "model": model, "effort": "medium"]]
    }

    typealias Counts = (input: Int, cached: Int, output: Int)

    static func codexTokens(time: String, total: Counts, last: Counts?, write: Int = 0, limits: [String: Any]? = nil) -> [String: Any] {
        func usage(_ c: Counts, write: Int) -> [String: Any] {
            ["input_tokens": c.input, "cached_input_tokens": c.cached, "cache_write_input_tokens": write,
             "output_tokens": c.output, "reasoning_output_tokens": c.output / 3, "total_tokens": c.input + c.output]
        }
        var info: [String: Any] = ["total_token_usage": usage(total, write: write), "model_context_window": 272_000]
        if let last { info["last_token_usage"] = usage(last, write: write) }
        var payload: [String: Any] = ["type": "token_count", "info": info]
        if let limits { payload["rate_limits"] = limits }
        return ["timestamp": time, "type": "event_msg", "payload": payload]
    }

    static let limits: [String: Any] = [
        "limit_id": "codex",
        "primary": ["used_percent": 12.5, "window_minutes": 300, "resets_at": 1_793_380_000],
        "secondary": ["used_percent": 40.0, "window_minutes": 10080, "resets_at": 1_793_900_000],
        "credits": ["has_credits": false, "unlimited": false, "balance": NSNull()],
        "plan_type": "pro",
    ]
}

final class ClaudeReaderTests: XCTestCase {
    let pricer = Pricer(list: .builtIn)
    let now = Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!)

    private func scan(_ home: TempHome, _ readers: [LogReader] = [ClaudeReader()]) -> ScanResult {
        UsageScanner(home: home.path, readers: readers, ledgerURL: nil).refresh(pricer: pricer, now: now, timeZone: utc)
    }

    func testCountsEachRequestOnceAndKeepsTheLargestLine() {
        let home = TempHome()
        home.write(".claude/projects/-Users-me-project/s1.jsonl", lines([
            Fixture.claudeUser(),
            Fixture.claude(id: "msg_1", output: 5),
            Fixture.claude(id: "msg_1", output: 1136), // same response, streamed: the output grew
            Fixture.claude(id: "msg_2", request: "req_2", model: "claude-sonnet-4-5-20250929", time: "2026-10-30T11:00:00.000Z"),
            Fixture.claude(id: "msg_3", request: "req_3", model: "<synthetic>", input: 0, output: 0, read: 0, write5m: 0),
        ]))
        // A resumed session repeats msg_1 in a new file; a /btw side question replays it with a new request id.
        home.write(".claude/projects/-Users-me-project/s2.jsonl", lines([Fixture.claude(id: "msg_1", output: 1136, session: "s2")]))
        home.write(".claude/projects/-Users-me-project/s1/subagents/agent-1.jsonl", lines([Fixture.claude(id: "msg_1", request: "req_9", output: 1136)]))
        let result = scan(home)
        let summary = result.summary
        XCTAssertEqual(summary.monthRequests, 2)
        XCTAssertEqual(summary.tools.map(\.tool), [.claudeCode])
        let opus = summary.models.first { $0.model == "claude-opus-4-6" }!
        XCTAssertEqual(opus.requests, 1)
        XCTAssertEqual(opus.tokens, 10 + 1136 + 1000 + 200)
        // $5 in, $25 out, $0.50 cache read, $6.25 5m write per million.
        let expected: Double = usd((10.0, 5), (1136.0, 25), (1000.0, 0.5), (200.0, 6.25))
        XCTAssertEqual(opus.cost, expected, accuracy: 1e-12)
        XCTAssertEqual(summary.models.first { $0.model.hasPrefix("claude-sonnet") }?.name, "Claude Sonnet 4.5")
        XCTAssertEqual(result.sources.first { $0.tool == .claudeCode }?.files, 3)
        XCTAssertEqual(result.sources.first { $0.tool == .claudeCode }?.requests, 2)
    }

    func testGatewayIdsAreNotMergedAcrossRequests() {
        let home = TempHome()
        home.write(".claude/projects/p/s.jsonl", lines([
            Fixture.claude(id: "gw-1", request: "a", output: 100),
            Fixture.claude(id: "gw-1", request: "b", output: 100),
        ]))
        XCTAssertEqual(scan(home).summary.monthRequests, 2)
    }

    func testAStreamedGatewayReplyWithoutRequestIdCountsOnce() {
        let home = TempHome()
        func line(_ id: String, output: Int, time: String) -> [String: Any] {
            var line = Fixture.claude(id: id, time: time, output: output)
            line.removeValue(forKey: "requestId")
            return line
        }
        home.write(".claude/projects/p/s.jsonl", lines([
            line("gen-1", output: 5, time: "2026-10-30T10:00:00.100Z"),
            line("gen-1", output: 900, time: "2026-10-30T10:00:03.900Z"), // the same reply, one content block later
            line("gen-2", output: 50, time: "2026-10-30T10:01:00.000Z"),
        ]))
        let summary = scan(home).summary
        XCTAssertEqual(summary.monthRequests, 2)
        XCTAssertEqual(summary.monthTokens, 2 * (10 + 1000 + 200) + 900 + 50)
    }

    func testPromptsRepliesThinkingAndToolInputAreNeverParsed() throws {
        let secret = #"SECRET "quoted" \\ back\\\\slash é {"usage":{"input_tokens":999999}} [ ] , : \\"#
        var line = Fixture.claude(id: "msg_s", output: 77)
        var message = line["message"] as! [String: Any]
        message["content"] = [
            ["type": "thinking", "thinking": secret, "signature": secret],
            ["type": "text", "text": secret],
            ["type": "tool_use", "id": "toolu_1", "name": "Bash", "input": ["command": secret, "description": secret]],
        ]
        line["message"] = message
        let text = lines([line])
        let skimmed = try text.utf8CString.withUnsafeBytes { raw in
            try XCTUnwrap(JSON.metadata(UnsafeRawBufferPointer(rebasing: raw.dropLast(2))))
        }
        let kept = String(decoding: skimmed, as: UTF8.self)
        XCTAssertFalse(kept.contains("SECRET"))
        XCTAssertFalse(kept.contains("999999"))
        XCTAssertTrue(kept.contains("msg_s") && kept.contains("claude-opus-4-6") && kept.contains("toolu_1"))

        let home = TempHome()
        home.write(".claude/projects/p/s.jsonl", text)
        let summary = scan(home).summary
        XCTAssertEqual(summary.monthRequests, 1)
        XCTAssertEqual(summary.monthTokens, 10 + 77 + 1000 + 200)

        // An escaped backslash just before a closing quote ends the string there.
        let tricky = Array(#"{"text":"a\\","model":"m","n":[1,{"text":"\""}]}"#.utf8)
        let out = tricky.withUnsafeBytes { JSON.metadata($0) }.map { String(decoding: $0, as: UTF8.self) }
        XCTAssertEqual(out, #"{"text":"","model":"m","n":[1,{"text":""}]}"#)
        XCTAssertNil(Array(#"{"text":"never closed}"#.utf8).withUnsafeBytes { JSON.metadata($0) })
    }

    func testServerSideCompactionIsBilled() {
        let home = TempHome()
        var line = Fixture.claude(id: "msg_k", model: "claude-opus-5-5", input: 0, output: 0, read: 0, write5m: 0)
        var message = line["message"] as! [String: Any]
        var usage = message["usage"] as! [String: Any]
        usage["iterations"] = [["type": "compaction", "input_tokens": 180_000, "output_tokens": 3_500],
                               ["type": "message", "input_tokens": 0, "output_tokens": 0]]
        message["usage"] = usage
        line["message"] = message
        home.write(".claude/projects/p/s.jsonl", lines([line]))
        let summary = scan(home).summary
        XCTAssertEqual(summary.monthTokens, 183_500)
        XCTAssertEqual(summary.monthCost, usd((180_000, 4), (3_500, 20)), accuracy: 1e-9)
    }

    func testTheClaudeAppsCodeTabAndOtherAccounts() {
        let home = TempHome()
        let session = "Library/Application Support/Claude/claude-code-sessions/acct/device/local_1"
        home.write(session + "/.claude/projects/-Users-me-p/s.jsonl", lines([Fixture.claude(id: "msg_app")]))
        home.write(session + "/outputs/data.jsonl", lines([Fixture.claude(id: "msg_not_a_transcript")]))
        home.write(".claude-work/projects/p/s.jsonl", lines([Fixture.claude(id: "msg_work", request: "w")]))
        home.write(".claude/projects/p/s.jsonl", lines([Fixture.claude(id: "msg_app")])) // the same reply again
        let result = scan(home)
        XCTAssertEqual(result.summary.monthRequests, 2)
        XCTAssertEqual(result.summary.tools.map(\.tool), [.claudeCode])
        XCTAssertTrue(result.sources.first { $0.tool == .claudeCode }!.folders.contains { $0.hasSuffix("/.claude-work/projects") })
    }

    func testFastModeOneHourCacheWebSearchAndAdvisor() {
        let home = TempHome()
        home.write(".claude/projects/p/s.jsonl", lines([
            Fixture.claude(id: "msg_a", input: 0, output: 1_000_000, read: 0, write5m: 0, write1h: 1_000_000, searches: 3),
            Fixture.claude(id: "msg_b", model: "claude-opus-5-5", input: 0, output: 1_000_000, read: 0, write5m: 0, speed: "fast",
                           advisor: ["type": "advisor_message", "model": "claude-fable-5-1", "input_tokens": 1_000_000, "output_tokens": 0]),
        ]))
        let summary = scan(home).summary
        // msg_a: $25 output + $10 1h writes + 3 searches at $10 per 1,000.
        // msg_b: Opus 5.5 fast, 2x of $20 output; the advisor's $10 of Fable 5.1 input comes on top.
        XCTAssertEqual(summary.monthCost, 35.03 + 40 + 10, accuracy: 1e-9)
        XCTAssertEqual(summary.monthRequests, 3)
        XCTAssertEqual(Set(summary.models.map(\.model)), ["claude-opus-4-6", "claude-opus-5-5", "claude-fable-5-1"])
    }

    func testSubagentProgressLines() {
        let home = TempHome()
        let inner = Fixture.claude(id: "msg_sub", request: "req_sub", output: 50)
        let progress: [String: Any] = ["type": "progress", "timestamp": "2026-10-30T10:00:00.000Z", "sessionId": "s1",
                                       "data": ["type": "agent_progress", "message": inner]]
        home.write(".claude/projects/p/s.jsonl", lines([progress]))
        // The same reply also in the subagent's own transcript: once.
        home.write(".claude/projects/p/s/subagents/agent-1.jsonl", lines([inner]))
        home.write(".claude/projects/p/s/subagents/workflows/w/journal.jsonl", lines([Fixture.claude(id: "msg_journal")]))
        let summary = scan(home).summary
        XCTAssertEqual(summary.monthRequests, 1)
    }

    func testCoworkTranscriptsAndAuditLog() {
        let home = TempHome()
        let session = "Library/Application Support/Claude/local-agent-mode-sessions/org/user/session"
        home.write(session + "/.claude/projects/-sessions-x/a.jsonl", lines([Fixture.claude(id: "msg_c1")]))
        // audit.jsonl: Agent SDK shape with snake_case ids; the same reply and one more.
        var audit = Fixture.claude(id: "msg_c1")
        audit.removeValue(forKey: "requestId")
        audit["request_id"] = "req_1"
        audit["_audit_timestamp"] = audit.removeValue(forKey: "timestamp")
        var second = Fixture.claude(id: "msg_c2")
        second["session_id"] = "s"
        second["_audit_timestamp"] = second.removeValue(forKey: "timestamp")
        let result: [String: Any] = ["type": "result", "total_cost_usd": 12.0, "usage": ["input_tokens": 99_999], "subtype": "success", "message": ["role": "assistant"]]
        home.write(session + "/audit.jsonl", lines([audit, second, result]))
        home.write(session + "/outputs/notes.jsonl", lines([Fixture.claude(id: "msg_not_a_transcript")]))
        let summary = scan(home).summary
        XCTAssertEqual(summary.tools.map(\.tool), [.cowork])
        XCTAssertEqual(summary.monthRequests, 2)
    }
}

final class CodexReaderTests: XCTestCase {
    let pricer = Pricer(list: .builtIn)
    let now = Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!)
    let rollout = "rollout-2026-10-30T09-00-00-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl"

    func testCountsEachResponseOnce() {
        let home = TempHome()
        home.write(".codex/sessions/2026/10/30/" + rollout, lines([
            ["timestamp": "2026-10-30T09:00:00.000Z", "type": "session_meta", "payload": ["id": "0199a1b2", "cli_version": "0.80.0", "originator": "codex_cli_rs"]],
            Fixture.codexTurn(model: "gpt-6.1-sol"),
            Fixture.codexTokens(time: "2026-10-30T09:01:00.000Z", total: (10_000, 8_000, 500), last: (10_000, 8_000, 500), limits: Fixture.limits),
            // Repeated on a rate-limit update: no new usage.
            Fixture.codexTokens(time: "2026-10-30T09:01:05.000Z", total: (10_000, 8_000, 500), last: (10_000, 8_000, 500), limits: Fixture.limits),
            Fixture.codexTokens(time: "2026-10-30T09:02:00.000Z", total: (25_000, 18_000, 1_500), last: (15_000, 10_000, 1_000)),
            // An estimate after compaction: no input or output.
            Fixture.codexTokens(time: "2026-10-30T09:03:00.000Z", total: (25_000, 18_000, 1_500), last: (0, 0, 0)),
        ]))
        let result = UsageScanner(home: home.path, readers: [CodexReader()], ledgerURL: nil).refresh(pricer: pricer, now: now, timeZone: utc)
        let model = result.summary.models.first!
        XCTAssertEqual(model.model, "gpt-6.1-sol")
        XCTAssertEqual(model.requests, 2)
        XCTAssertEqual(model.tokens, 25_000 + 1_500)
        // Uncached input 7,000 at $2, cached 18,000 at $0.10, output 1,500 at $10 (reasoning inside).
        let expected: Double = usd((7_000.0, 2), (18_000.0, 0.1), (1_500.0, 10))
        XCTAssertEqual(model.cost, expected, accuracy: 1e-12)
        XCTAssertEqual(result.codexLimits?.primary?.usedPercent, 12.5)
        XCTAssertEqual(result.codexLimits?.primary?.windowMinutes, 300)
        XCTAssertEqual(result.codexLimits?.primary?.resetsAt, 1_793_380_000)
        XCTAssertEqual(result.codexLimits?.secondary?.usedPercent, 40)
        XCTAssertEqual(result.codexLimits?.planType, "pro")
    }

    func testForkedArchivedAndAppendedCopiesCountOnce() {
        let home = TempHome()
        let file = ".codex/sessions/2026/10/30/" + rollout
        let parent = [
            Fixture.codexTurn(model: "gpt-5.2-codex"),
            Fixture.codexTokens(time: "2026-10-30T09:01:00.000Z", total: (1_000, 0, 100), last: (1_000, 0, 100)),
        ]
        home.write(file, lines(parent))
        let scanner = UsageScanner(home: home.path, readers: [CodexReader()], ledgerURL: nil)
        XCTAssertEqual(scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary.monthTokens, 1_100)
        home.append(file, lines([Fixture.codexTokens(time: "2026-10-30T09:02:00.000Z", total: (3_000, 1_000, 300), last: (2_000, 1_000, 200))]))
        var result = scanner.refresh(pricer: pricer, now: now, timeZone: utc)
        XCTAssertTrue(result.changed)
        XCTAssertEqual(result.summary.monthTokens, 3_300)
        XCTAssertEqual(result.summary.monthRequests, 2)
        // Codex moves old threads to archived_sessions.
        home.write(".codex/archived_sessions/" + rollout, try! String(contentsOfFile: home.path + "/" + file))
        // A fork copies the parent's lines (with new timestamps), then goes on.
        var copied = parent
        copied[1]["timestamp"] = "2026-10-30T10:00:00.000Z"
        home.write(".codex/sessions/2026/10/30/rollout-2026-10-30T10-00-00-0199ffff-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl", lines(copied + [
            Fixture.codexTokens(time: "2026-10-30T10:01:00.000Z", total: (1_500, 500, 150), last: (500, 500, 50)),
        ]))
        result = scanner.refresh(pricer: pricer, now: now, timeZone: utc)
        XCTAssertEqual(result.summary.monthRequests, 3)
        XCTAssertEqual(result.summary.monthTokens, 3_300 + 550)
        XCTAssertFalse(scanner.refresh(pricer: pricer, now: now, timeZone: utc).changed)
    }

    func testCacheWritesFastTierAndConfigDefaults() {
        let home = TempHome()
        home.write(".codex/config.toml", "model = \"gpt-6-sol\"\nservice_tier = \"fast\"\n\n[profiles.x]\nmodel = \"o3\"\n")
        home.write(".codex/sessions/2026/10/30/" + rollout, lines([
            // No turn_context: the model and tier come from config.toml.
            Fixture.codexTokens(time: "2026-10-30T09:01:00.000Z", total: (100_000, 0, 0), last: (100_000, 0, 0), write: 100_000),
        ]))
        let summary = UsageScanner(home: home.path, readers: [CodexReader()], ledgerURL: nil).refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(summary.models.first?.model, "gpt-6-sol")
        // 100K cache-write tokens inside the input at $2.50 per million, Fast tier at twice the price.
        XCTAssertEqual(summary.monthCost, 0.5, accuracy: 1e-9)
    }

    func testAResponseCutShortCountsWhatTheTotalGrew() {
        let home = TempHome()
        home.write(".codex/sessions/2026/10/30/" + rollout, lines([
            Fixture.codexTurn(model: "gpt-5"),
            Fixture.codexTokens(time: "2026-10-30T09:01:00.000Z", total: (10_000, 8_000, 500), last: (10_000, 8_000, 500)),
            // Stopped at the output limit: Codex adds it to the total and leaves `last` as it was.
            Fixture.codexTokens(time: "2026-10-30T09:02:00.000Z", total: (13_000, 10_000, 4_500), last: (10_000, 8_000, 500)),
        ]))
        let summary = UsageScanner(home: home.path, readers: [CodexReader()], ledgerURL: nil).refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(summary.monthRequests, 2)
        XCTAssertEqual(summary.monthTokens, 17_500)
    }

    func testOlderLogsWithoutLastUsage() {
        let home = TempHome()
        home.write(".codex/sessions/2026/10/30/" + rollout, lines([
            Fixture.codexTurn(model: "gpt-5"),
            Fixture.codexTokens(time: "2026-10-30T09:01:00.000Z", total: (1_000, 0, 100), last: nil),
            Fixture.codexTokens(time: "2026-10-30T09:02:00.000Z", total: (3_000, 1_000, 300), last: nil),
            Fixture.codexTokens(time: "2026-10-30T09:02:30.000Z", total: (3_000, 1_000, 300), last: nil),
        ]))
        let summary = UsageScanner(home: home.path, readers: [CodexReader()], ledgerURL: nil).refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(summary.monthRequests, 2)
        XCTAssertEqual(summary.monthTokens, 3_300)
    }
}

final class GeminiReaderTests: XCTestCase {
    let pricer = Pricer(list: .builtIn)
    let now = Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!)

    static let reply: [String: Any] = ["id": "g1", "timestamp": "2026-10-30T09:00:05.000Z", "type": "gemini", "content": "…", "model": "gemini-2.5-pro",
                                       "tokens": ["input": 12_000, "output": 800, "cached": 10_000, "thoughts": 400, "tool": 0, "total": 13_200]]

    func testReadsJSONLRecordingsAndSubagents() {
        let home = TempHome()
        let path = ".gemini/tmp/my-project/chats/session-2026-10-30T09-00-1a2b3c4d.jsonl"
        var pending = GeminiReaderTests.reply
        pending.removeValue(forKey: "tokens")
        home.write(path, lines([
            ["sessionId": "1a2b3c4d-full", "projectHash": "abc", "startTime": "2026-10-30T09:00:00.000Z", "lastUpdated": "2026-10-30T09:00:00.000Z", "kind": "main"],
            ["id": "u1", "timestamp": "2026-10-30T09:00:00.000Z", "type": "user", "content": "…"],
            pending,
            GeminiReaderTests.reply, // written again when its tokens arrived
            ["$rewindTo": "u1"],
        ]))
        var sub = GeminiReaderTests.reply
        sub["id"] = "s1"
        home.write(".gemini/tmp/my-project/chats/1a2b3c4d-full/9f8e7d6c.jsonl", lines([
            ["sessionId": "9f8e7d6c", "projectHash": "abc", "kind": "subagent"], sub,
        ]))
        let scanner = UsageScanner(home: home.path, readers: [GeminiReader()], ledgerURL: nil)
        var summary = scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(summary.monthRequests, 2)
        XCTAssertEqual(summary.monthTokens, 2 * (2_000 + 10_000 + 1_200))
        let one: Double = usd((2_000.0, 1.25), (10_000.0, 0.125), (1_200.0, 10))
        XCTAssertEqual(summary.monthCost, 2 * one, accuracy: 1e-12)
        var later = GeminiReaderTests.reply
        later["id"] = "g2"
        home.append(path, lines([later]))
        summary = scanner.refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(summary.monthRequests, 3)
    }

    func testLegacyJSONAndItsResumedCopy() {
        let home = TempHome()
        let doc: [String: Any] = ["sessionId": "abcd", "projectHash": "h", "startTime": "2026-10-30T09:00:00.000Z",
                                  "messages": [["id": "u1", "timestamp": "2026-10-30T09:00:00.000Z", "type": "user", "content": "…"], GeminiReaderTests.reply]]
        home.write(".gemini/tmp/abc/chats/session-2026-10-30T09-00-abcd.json", String(data: try! JSONSerialization.data(withJSONObject: doc), encoding: .utf8)!)
        // Resuming copies the legacy chat into a .jsonl recording.
        home.write(".gemini/tmp/abc/chats/session-2026-10-30T09-00-abcd.jsonl", lines([
            ["sessionId": "abcd", "projectHash": "h"], ["$set": ["messages": doc["messages"]!]],
        ]))
        let summary = UsageScanner(home: home.path, readers: [GeminiReader()], ledgerURL: nil).refresh(pricer: pricer, now: now, timeZone: utc).summary
        XCTAssertEqual(summary.monthRequests, 1)
    }
}

final class QwenReaderTests: XCTestCase {
    func testSubagentsTakeTheirModelFromTheMetaFile() {
        let home = TempHome()
        let folder = ".qwen/projects/-Users-me-p/subagents/s1/"
        home.write(folder + "agent-a1.meta.json", #"{"agentId":"a1","agentType":"general","parentSessionId":"s1","parentAgentId":null,"createdAt":"2026-10-30T09:00:00Z","model":"qwen3.7-plus"}"#)
        home.write(folder + "agent-a1.jsonl", lines([
            ["uuid": "x1", "sessionId": "s1", "agentId": "a1", "timestamp": "2026-10-30T09:00:00.000Z", "type": "assistant",
             "message": ["role": "model", "parts": [["text": "…"]]],
             "usageMetadata": ["promptTokenCount": 10_000, "cachedContentTokenCount": 8_000, "candidatesTokenCount": 500, "totalTokenCount": 10_500]],
        ]))
        home.write(folder + "agent-a1.jsonl.stream", "{}\n")
        let summary = UsageScanner(home: home.path, readers: [QwenReader()], ledgerURL: nil)
            .refresh(pricer: Pricer(list: .builtIn), now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc).summary
        XCTAssertEqual(summary.monthRequests, 1)
        XCTAssertEqual(summary.models.first?.model, "qwen3.7-plus")
        XCTAssertEqual(summary.monthCost, usd((2_000, 0.4), (8_000, 0.04), (500, 1.6)), accuracy: 1e-12)
    }

    func testUsageMetadataAndBranchCopies() {
        let home = TempHome()
        func line(_ uuid: String, prompt: Int, cached: Int, candidates: Int, thoughts: Int, total: Int) -> [String: Any] {
            ["uuid": uuid, "sessionId": "s", "timestamp": "2026-10-30T09:00:00.000Z", "type": "assistant", "model": "gpt-5.4",
             "usageMetadata": ["promptTokenCount": prompt, "cachedContentTokenCount": cached, "candidatesTokenCount": candidates,
                               "thoughtsTokenCount": thoughts, "totalTokenCount": total]]
        }
        home.write(".qwen/projects/-Users-me-p/chats/s.jsonl", lines([
            ["uuid": "u0", "type": "user", "timestamp": "2026-10-30T09:00:00.000Z", "message": "…"],
            // Gemini-style: thoughts on top of the candidates.
            line("a", prompt: 1_000, cached: 400, candidates: 100, thoughts: 50, total: 1_150),
            // OpenAI-compatible: the candidates already include the thoughts.
            line("b", prompt: 1_000, cached: 0, candidates: 100, thoughts: 50, total: 1_100),
        ]))
        // /branch copies records with their uuid.
        home.write(".qwen/projects/-Users-me-p/chats/t.jsonl", lines([line("a", prompt: 1_000, cached: 400, candidates: 100, thoughts: 50, total: 1_150)]))
        let summary = UsageScanner(home: home.path, readers: [QwenReader()], ledgerURL: nil)
            .refresh(pricer: Pricer(list: .builtIn), now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc).summary
        XCTAssertEqual(summary.monthRequests, 2)
        XCTAssertEqual(summary.monthTokens, 1_150 + 1_100)
        let expected: Double = usd((600.0, 2.5), (400.0, 0.25), (150.0, 15), (1_000.0, 2.5), (100.0, 15))
        XCTAssertEqual(summary.monthCost, expected, accuracy: 1e-12)
    }
}

final class OpenCodeReaderTests: XCTestCase {
    static func message(_ id: String, model: String, cost: Double = 0.5) -> [String: Any] {
        ["id": id, "sessionID": "ses_1", "role": "assistant", "modelID": model, "providerID": "anthropic",
         "time": ["created": 1_793_350_000_000, "completed": 1_793_350_005_000], "cost": cost,
         "tokens": ["input": 100, "output": 50, "reasoning": 10, "cache": ["read": 1000, "write": 0]]]
    }

    func testReadsMessageFiles() {
        let home = TempHome()
        for (id, model) in [("msg_abc", "claude-sonnet-4-5"), ("msg_def", "some-local-model")] {
            home.write(".local/share/opencode/storage/message/ses_1/\(id).json",
                       String(data: try! JSONSerialization.data(withJSONObject: OpenCodeReaderTests.message(id, model: model)), encoding: .utf8)!)
        }
        let summary = UsageScanner(home: home.path, readers: [OpenCodeReader()], ledgerURL: nil)
            .refresh(pricer: Pricer(list: .builtIn), now: Date(timeIntervalSince1970: Timestamp.parse("2026-10-30T12:00:00Z")!), timeZone: utc).summary
        XCTAssertEqual(summary.monthRequests, 2)
        let sonnet = summary.models.first { $0.model == "claude-sonnet-4-5" }!
        let expected: Double = usd((100.0, 3), (60.0, 15), (1000.0, 0.3))
        XCTAssertEqual(sonnet.cost, expected, accuracy: 1e-12)
        XCTAssertEqual(sonnet.basis, .listed)
        let local = summary.models.first { $0.model == "some-local-model" }!
        XCTAssertEqual(local.cost, 0.5)
        XCTAssertEqual(local.basis, .logged)
    }
}
