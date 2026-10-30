import XCTest
@testable import ClaiCore

final class PricingTests: XCTestCase {
    let pricer = Pricer(list: .builtIn)

    private func id(_ model: String) -> String? { pricer.match(model)?.prices.first?.id }

    func testBuiltInListIsValid() {
        XCTAssertTrue(PriceList.builtIn.isValid)
    }

    func testNormalizesLoggedIds() {
        XCTAssertEqual(Pricer.normalize("claude-sonnet-4-5-20250929"), "claude-sonnet-4-5")
        XCTAssertEqual(Pricer.normalize("claude-opus-4-6[1m]"), "claude-opus-4-6")
        XCTAssertEqual(Pricer.normalize("us.anthropic.claude-sonnet-4-20250514-v1:0"), "claude-sonnet-4")
        XCTAssertEqual(Pricer.normalize("claude-opus-4-1@20250805"), "claude-opus-4-1")
        XCTAssertEqual(Pricer.normalize("anthropic/claude-opus-4.5"), "claude-opus-4-5")
        XCTAssertEqual(Pricer.normalize("openai/gpt-5.1-codex"), "gpt-5.1-codex")
        XCTAssertEqual(Pricer.normalize("models/gemini-2.5-pro"), "gemini-2.5-pro")
        XCTAssertEqual(Pricer.normalize("gpt-5-2025-08-07"), "gpt-5")
        XCTAssertEqual(Pricer.normalize("gemini-2.5-flash-preview-05-20"), "gemini-2.5-flash-preview")
    }

    func testExactMatchesAndAliases() {
        XCTAssertEqual(id("claude-opus-5-5"), "claude-opus-5-5")
        XCTAssertEqual(pricer.match("claude-opus-5-5")?.exact, true)
        XCTAssertEqual(id("claude-sonnet-4-5-20250929"), "claude-sonnet-4-5")
        XCTAssertEqual(id("gpt-5-codex"), "gpt-5")
        XCTAssertEqual(id("gpt-5.1-codex-max"), "gpt-5.1")
        XCTAssertEqual(id("gpt-5.2-codex-high"), "gpt-5.2")
        XCTAssertEqual(id("claude-3-5-sonnet-latest"), "claude-3-5-sonnet")
        XCTAssertEqual(id("gemini-2.5-flash-preview-05-20"), "gemini-2.5-flash")
    }

    func testNewVersionsUseTheNearestOlderVersionOfTheirFamily() {
        // A version number is never dropped: Opus 5.6 is priced like Opus 5.5, not Opus 5.
        let opus = pricer.match("claude-opus-5-6")
        XCTAssertEqual(opus?.prices.first?.id, "claude-opus-5-5")
        XCTAssertEqual(opus?.exact, false)
        XCTAssertEqual(id("claude-sonnet-4-7"), "claude-sonnet-4-6")
        XCTAssertEqual(id("gpt-5.7"), "gpt-5.5")
        XCTAssertEqual(id("gpt-5.5-mini"), "gpt-5.4-mini")
        XCTAssertEqual(id("gemini-3.9-flash"), "gemini-3.8-flash")
        XCTAssertNil(pricer.match("some-local-model"))
        XCTAssertNil(pricer.match(""))
    }

    func testCostOfAClaudeRequest() {
        let opus = pricer.match("claude-opus-4-6")!.prices[0]
        // 1M uncached input $5, 1M output $25, 1M cache reads $0.50, 1M 5m writes $6.25, 1M 1h writes $10
        let t = Tokens(input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000)
        XCTAssertEqual(opus.cost(of: t, long: false, fast: false), 46.75, accuracy: 1e-9)
    }

    func testLongContextTier() {
        let sonnet = pricer.match("claude-sonnet-4-5")!.prices[0]
        let small = Tokens(input: 1000, output: 100, cacheRead: 150_000)
        let big = Tokens(input: 1000, output: 100, cacheRead: 250_000)
        XCTAssertFalse(sonnet.isLong(small))
        XCTAssertTrue(sonnet.isLong(big))
        let expected: Double = (1000.0 * 6 + 100.0 * 22.5 + 250_000.0 * 0.6) / 1_000_000
        XCTAssertEqual(sonnet.cost(of: big, long: true, fast: false), expected, accuracy: 1e-12)
        XCTAssertFalse(pricer.match("claude-opus-4-6")!.prices[0].isLong(big))
    }

    func testPricesThatChangeOnADay() {
        let sonnet = pricer.match("claude-sonnet-5-5")!
        let reads = Tokens(cacheRead: 1_000_000)
        XCTAssertEqual(sonnet.price(on: Day(year: 2026, month: 10, day: 6)).cost(of: reads, long: false, fast: false), 0.2, accuracy: 1e-12)
        XCTAssertEqual(sonnet.price(on: Day(year: 2026, month: 10, day: 7)).cost(of: reads, long: false, fast: false), 0.1, accuracy: 1e-12)
        let argon = pricer.match("gemini-4-argon")!
        let output = Tokens(output: 1_000_000)
        XCTAssertEqual(argon.price(on: Day(year: 2026, month: 11, day: 30)).cost(of: output, long: false, fast: false), 10, accuracy: 1e-12)
        XCTAssertEqual(argon.price(on: Day(year: 2026, month: 12, day: 1)).cost(of: output, long: false, fast: false), 20, accuracy: 1e-12)
        XCTAssertEqual(argon.name, "Gemini 4 Argon")
    }

    func testOpenAICacheWritesLongContextAndFastTier() {
        let sol = pricer.match("gpt-6.1-sol")!.prices[0]
        let t = Tokens(input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000)
        // $2 input, $10 output, $0.10 cached, $2.50 cache writes
        XCTAssertEqual(sol.cost(of: t, long: false, fast: false), 14.6, accuracy: 1e-9)
        XCTAssertEqual(sol.cost(of: t, long: false, fast: true), 29.2, accuracy: 1e-9)
        XCTAssertTrue(sol.isLong(Tokens(input: 100_000, cacheRead: 180_000)))
        XCTAssertEqual(sol.cost(of: t, long: true, fast: false), 4 + 15 + 0.2 + 5, accuracy: 1e-9)
        // GPT-5.2 bills cache writes as plain input and has no long-context tier.
        let older = pricer.match("gpt-5.2-codex")!.prices[0]
        XCTAssertEqual(older.cost(of: Tokens(cacheWrite: 1_000_000), long: false, fast: false), 1.75, accuracy: 1e-12)
        XCTAssertFalse(older.isLong(Tokens(input: 500_000)))
    }

    func testClaudeFastMode() {
        let opus46 = pricer.match("claude-opus-4-6")!.prices[0]
        let opus55 = pricer.match("claude-opus-5-5")!.prices[0]
        let out = Tokens(output: 1_000_000)
        XCTAssertEqual(opus46.cost(of: out, long: false, fast: true), 150, accuracy: 1e-9)
        XCTAssertEqual(opus55.cost(of: out, long: false, fast: true), 40, accuracy: 1e-9)
        XCTAssertEqual(pricer.match("claude-sonnet-4-5")!.prices[0].cost(of: out, long: false, fast: true), 15, accuracy: 1e-9, "no fast price: standard")
    }

    func testDottedClaudeIds() {
        XCTAssertEqual(id("anthropic/claude-sonnet-4.5"), "claude-sonnet-4-5")
        XCTAssertEqual(id("claude-opus-4.6"), "claude-opus-4-6")
    }

    func testPlans() {
        XCTAssertEqual(PriceList.builtIn.plans.first { $0.id == "claude-max-5x" }?.monthly, 100)
        XCTAssertTrue(PriceList.builtIn.plans.contains { $0.vendor == .openai })
        XCTAssertTrue(PriceList.builtIn.plans.contains { $0.vendor == .google })
    }

    func testPriceListRoundTripsThroughJSON() throws {
        let data = try JSONEncoder().encode(PriceList.builtIn)
        let decoded = PriceList.decode(data)
        XCTAssertNotNil(decoded)
        XCTAssertEqual(decoded?.models, PriceList.builtIn.models)
        XCTAssertNil(PriceList.decode(Data("{\"version\":\"x\",\"webSearchPer1k\":10,\"models\":[],\"plans\":[]}".utf8)))
        var twice = PriceList.builtIn
        twice.models.append(twice.models[0])
        XCTAssertFalse(twice.isValid, "one model, one day, two prices")
        var broken = PriceList.builtIn
        broken.models[0].rates.input = -1
        XCTAssertNil(PriceList.decode(try JSONEncoder().encode(broken)))
    }
}
