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
        // `preview` is not part of the family: a Pro release follows the newest Pro, preview or not.
        XCTAssertEqual(id("gemini-3.1-pro"), "gemini-3.1-pro-preview")
        XCTAssertEqual(id("gemini-3.5-pro"), "gemini-3.1-pro-preview")
        XCTAssertEqual(id("gemini-4-pro"), "gemini-3.1-pro-preview")
        XCTAssertEqual(id("gemini-3.2-flash"), "gemini-3-flash-preview")
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
        let expected: Double = usd((1000.0, 6), (100.0, 22.5), (250_000.0, 0.6))
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
        XCTAssertEqual(sol.cost(of: t, long: true, fast: false), 24.2, accuracy: 1e-9) // 4 + 15 + 0.20 + 5
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

    func testQwenTiersAndSnapshots() {
        let plus = pricer.match("qwen3.6-plus-2026-04-02")
        XCTAssertEqual(plus?.exact, true)
        let price = plus!.price(on: Day(year: 2026, month: 10, day: 30))
        let short = Tokens(input: 100_000, output: 1_000, cacheRead: 100_000)
        let long = Tokens(input: 200_000, output: 1_000, cacheRead: 100_000)
        XCTAssertFalse(price.isLong(short))
        XCTAssertTrue(price.isLong(long))
        XCTAssertEqual(price.cost(of: short, long: false, fast: false), usd((100_000, 0.5), (100_000, 0.05), (1_000, 3)), accuracy: 1e-12)
        XCTAssertEqual(price.cost(of: long, long: true, fast: false), usd((200_000, 2), (100_000, 0.2), (1_000, 6)), accuracy: 1e-12)
        XCTAssertEqual(id("qwen/qwen3.7-max"), "qwen3.7-max")
        XCTAssertEqual(id("qwen3.7-max-preview"), "qwen3.7-max")
        XCTAssertNil(pricer.match("qwen3-coder-plus"), "four tiers: no price rather than a wrong one")
        XCTAssertNil(pricer.match("coder-model"))
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

    func testAPublishedListCanAddAndChangeButNotRemoveOrBreak() throws {
        func published(_ change: (inout PriceList) -> Void) throws -> PriceList? {
            var list = PriceList.builtIn
            list.version = "2099-01-01"
            change(&list)
            return PriceList.published(try JSONEncoder().encode(list))
        }
        // A list that lost every Claude model still prices Claude.
        let noClaude = try XCTUnwrap(try published { $0.models.removeAll { $0.id.hasPrefix("claude") } })
        XCTAssertEqual(Pricer(list: noClaude).match("claude-opus-5-5")?.exact, true)
        // A changed price and a new model come through.
        let changed = try XCTUnwrap(try published {
            $0.models[0].rates.output = 99
            $0.models.append(ModelPrice(id: "brand-new-1", name: "Brand New 1", rates: Rates(input: 1, output: 2)))
        })
        XCTAssertEqual(Pricer(list: changed).match(PriceList.builtIn.models[0].id)?.prices.last?.rates.output, 99)
        XCTAssertNotNil(Pricer(list: changed).match("brand-new-1"))
        // Numbers that would break the panel are refused.
        XCTAssertNil(try published { $0.webSearchPer1k = 1e300 })
        XCTAssertNil(try published { $0.plans[0].monthly = 1e-300 })
        XCTAssertNil(try published { $0.models[0].long = .init(above: -1, rates: $0.models[0].rates) })
        // Not newer than the built-in list: not used.
        var old = PriceList.builtIn
        old.version = "2000-01-01"
        XCTAssertNil(PriceList.published(try JSONEncoder().encode(old)))
        // Formatting never traps, whatever the numbers.
        XCTAssertEqual(Format.usd(1e300), "–")
        XCTAssertEqual(Format.usdShort(-1e300), "–")
        XCTAssertEqual(Format.multiple(1e300), "–")
        XCTAssertEqual(Format.count(Int.min).isEmpty, false)
    }
}

/// apps/site/public/prices.json is what installed copies fetch once a day. It must be the list the
/// app is built with: `UPDATE_PRICES_JSON=1 swift test --filter SitePriceList` rewrites it after a
/// change to Prices.swift.
final class SitePriceListTests: XCTestCase {
    func testSitePriceListIsTheBuiltInList() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("site/public/prices.json")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(PriceList.builtIn)
        if ProcessInfo.processInfo.environment["UPDATE_PRICES_JSON"] == "1" {
            try (data + Data("\n".utf8)).write(to: url)
        }
        let published = try XCTUnwrap(PriceList.decode(try Data(contentsOf: url)), "prices.json does not decode or is not valid")
        XCTAssertEqual(published, PriceList.builtIn, "run UPDATE_PRICES_JSON=1 swift test --filter SitePriceList")
    }
}
