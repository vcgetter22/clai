import XCTest
@testable import ClaiKit

/// The fixture is written by apps/server/src/snapshot.test.ts from the real engine, so these
/// tests fail when the TypeScript and Swift sides disagree on the snapshot's shape.
enum Fixture {
    static var url: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/snapshot.json")
    }

    static func data() throws -> Data { try Data(contentsOf: url) }

    static func snapshot() throws -> Snapshot { try Snapshot.decode(data()) }
}

final class SnapshotTests: XCTestCase {
    func testDecodesTheEngineFixture() throws {
        let s = try Fixture.snapshot()
        XCTAssertEqual(s.schema, 1)
        XCTAssertEqual(s.timeZone, "UTC")
        XCTAssertEqual(s.today.day, "2026-10-19")
        XCTAssertEqual(s.month.key, "2026-10")
        XCTAssertEqual(s.monthName, "October")
        XCTAssertEqual(s.lastMonthName, "September")
        XCTAssertEqual(s.month.basisKind, .apiEquivalent)
        XCTAssertNil(s.month.billedUsd)
        XCTAssertEqual(s.daily.count, 30)
        XCTAssertEqual(s.daily.last?.day, "2026-10-19")
        XCTAssertGreaterThan(s.month.usd, s.today.usd)
        XCTAssertGreaterThan(s.forecast.projectedUsd, s.month.usd)
        XCTAssertTrue(s.forecast.hasEnoughData)
        XCTAssertEqual(s.providers.map(\.label), ["Anthropic", "OpenAI", "Google"])
        XCTAssertEqual(s.tools.first?.label, "Claude Code")
        XCTAssertEqual(s.tools.first?.provider, "anthropic")
        XCTAssertEqual(s.models.first?.label, "Claude Opus 5")
        XCTAssertEqual(s.plans.first?.label, "Claude Max 5x")
        XCTAssertGreaterThan(s.plans.first?.multiple ?? 0, 1)
        XCTAssertEqual(s.budgets.first?.name, "AI tools")
        XCTAssertFalse(s.insights.isEmpty)
        XCTAssertTrue(s.planOptions.contains { $0.provider == "anthropic" && $0.plan == "max_5x" })
        XCTAssertEqual(s.scan?.watchPaths.count, 3)
        XCTAssertEqual(s.foundSources.map(\.id), ["claude-code", "codex-cli", "gemini-cli"])
        XCTAssertFalse(s.isEmpty)
        XCTAssertNotNil(s.generatedDate)
        XCTAssertEqual(s.month.elapsedFraction, 19.0 / 31.0, accuracy: 1e-9)
    }

    func testRejectsANewerSchema() throws {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: Fixture.data()) as? [String: Any])
        json["schema"] = 2
        let data = try JSONSerialization.data(withJSONObject: json)
        XCTAssertThrowsError(try Snapshot.decode(data)) { error in
            XCTAssertEqual(error as? EngineError, .unsupportedSchema(2))
        }
    }

    func testIgnoresFieldsAddedLater() throws {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: Fixture.data()) as? [String: Any])
        json["somethingNew"] = ["a": 1]
        let data = try JSONSerialization.data(withJSONObject: json)
        XCTAssertNoThrow(try Snapshot.decode(data))
    }

    func testBudgetStatus() {
        var budget = Snapshot.Budget(id: "b", name: "AI", amountUsd: 100, mtdUsd: 50, projectedUsd: 90, usedPct: 0.5, projectedPct: 0.9)
        XCTAssertEqual(budget.status, .fine)
        budget.projectedPct = 1.2
        XCTAssertEqual(budget.status, .onPaceToExceed)
        budget.usedPct = 1.05
        XCTAssertEqual(budget.status, .over)
    }

    func testUnknownStringsFallBackSafely() {
        let insight = Snapshot.Insight(id: "x", kind: "new_kind", severity: "dramatic", title: "t", detail: "d", action: nil, impactUsdPerMonth: nil)
        XCTAssertEqual(insight.level, .info)
        XCTAssertEqual(Basis(rawValue: "mixed")?.label, "Billed + API-equivalent")
    }
}

final class ProvidersTests: XCTestCase {
    func testGroupsPlanOptionsInCatalogOrder() throws {
        let groups = Providers.group(try Fixture.snapshot().planOptions)
        XCTAssertEqual(groups.first?.label, "Anthropic")
        XCTAssertTrue(groups.first?.options.allSatisfy { $0.provider == "anthropic" } ?? false)
        XCTAssertEqual(Set(groups.map(\.provider)).count, groups.count)
        XCTAssertEqual(Providers.label("github"), "GitHub Copilot")
        XCTAssertEqual(Providers.label("acme"), "acme")
    }
}
