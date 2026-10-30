import Foundation

/// USD per million tokens.
public struct Rates: Codable, Hashable, Sendable {
    public var input: Double
    public var output: Double
    /// Cache reads; nil bills them as input.
    public var cacheRead: Double?
    /// 5-minute (or unspecified) cache writes; nil bills them as input.
    public var cacheWrite: Double?
    /// 1-hour cache writes; nil bills them like `cacheWrite`.
    public var cacheWrite1h: Double?

    public init(input: Double, output: Double, cacheRead: Double? = nil, cacheWrite: Double? = nil, cacheWrite1h: Double? = nil) {
        self.input = input
        self.output = output
        self.cacheRead = cacheRead
        self.cacheWrite = cacheWrite
        self.cacheWrite1h = cacheWrite1h
    }

    /// The price of these tokens in USD.
    public func cost(of t: Tokens) -> Double {
        let write = cacheWrite ?? input
        let sum = Double(t.input) * input
            + Double(t.output) * output
            + Double(t.cacheRead) * (cacheRead ?? input)
            + Double(t.cacheWrite) * write
            + Double(t.cacheWrite1h) * (cacheWrite1h ?? write)
        return sum / 1_000_000
    }

    var isValid: Bool {
        [input, output, cacheRead ?? 0, cacheWrite ?? 0, cacheWrite1h ?? 0].allSatisfy { $0.isFinite && $0 >= 0 && $0 < 10_000 }
    }
}

/// One model's list price.
public struct ModelPrice: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var aliases: [String]?
    public var rates: Rates
    /// Requests whose whole prompt exceeds `above` tokens are billed at these rates instead.
    public var long: LongContext?
    /// Price multiple for fast mode (Claude Code) or the Fast/priority tier (OpenAI).
    public var fast: Double?
    /// `yyyy-mm-dd`: this price applies from that day on. A model can have several prices with
    /// different `since` days (introductory prices, price changes); usage is priced at the price
    /// of the day it happened.
    public var since: String?

    public struct LongContext: Codable, Hashable, Sendable {
        public var above: Int64
        public var rates: Rates
    }

    public init(id: String, name: String, aliases: [String]? = nil, rates: Rates, long: LongContext? = nil, fast: Double? = nil, since: String? = nil) {
        self.id = id
        self.name = name
        self.aliases = aliases
        self.rates = rates
        self.long = long
        self.fast = fast
        self.since = since
    }

    /// The first day of `since`, or nil for a price without a start day.
    public var sinceDay: Day? {
        guard let since, since.count == 10 else { return nil }
        let parts = since.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]), (1...31).contains(parts[2]) else { return nil }
        return Day(year: parts[0], month: parts[1], day: parts[2])
    }

    /// Whether a request of these tokens is billed at the long-context rates.
    public func isLong(_ tokens: Tokens) -> Bool {
        guard let long else { return false }
        return tokens.prompt > long.above
    }

    /// The price of tokens that were all billed at one tier.
    public func cost(of tokens: Tokens, long isLong: Bool, fast isFast: Bool) -> Double {
        let r = isLong ? (long?.rates ?? rates) : rates
        return r.cost(of: tokens) * (isFast ? (fast ?? 1) : 1)
    }
}

/// The price list: compiled into the app (`PriceList.builtIn`) and refreshed from
/// getclai.vercel.app/prices.json when a newer one is published.
public struct PriceList: Codable, Sendable, Equatable {
    /// `yyyy-mm-dd` of the last change; a newer date wins.
    public var version: String
    /// USD per 1,000 server-side web searches (Anthropic).
    public var webSearchPer1k: Double
    public var models: [ModelPrice]
    /// Subscription plans and their monthly price, for plan value.
    public var plans: [Plan]

    public init(version: String, webSearchPer1k: Double, models: [ModelPrice], plans: [Plan]) {
        self.version = version
        self.webSearchPer1k = webSearchPer1k
        self.models = models
        self.plans = plans
    }

    /// A list that can be trusted: decodes, has models, every rate finite and sane, no model listed
    /// twice for the same day.
    public var isValid: Bool {
        guard models.count >= 10, webSearchPer1k.isFinite, webSearchPer1k >= 0 else { return false }
        var ids = Set<String>()
        for m in models {
            guard !m.id.isEmpty, !m.name.isEmpty, m.rates.isValid, m.long?.rates.isValid ?? true,
                  (m.fast ?? 1).isFinite, (m.fast ?? 1) >= 1, (m.fast ?? 1) <= 20,
                  m.since == nil || m.sinceDay != nil,
                  ids.insert(m.id + "@" + (m.since ?? "")).inserted else { return false }
        }
        var planIds = Set<String>()
        for plan in plans {
            guard !plan.id.isEmpty, plan.monthly.isFinite, plan.monthly > 0, planIds.insert(plan.id).inserted else { return false }
        }
        return true
    }

    public static func decode(_ data: Data) -> PriceList? {
        guard let list = try? JSONDecoder().decode(PriceList.self, from: data), list.isValid else { return nil }
        return list
    }
}

/// A subscription, for plan value: what the month's usage would have cost at API prices,
/// against what the plan costs.
public struct Plan: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var vendor: Vendor
    public var name: String
    /// USD per month.
    public var monthly: Double

    public init(id: String, vendor: Vendor, name: String, monthly: Double) {
        self.id = id
        self.vendor = vendor
        self.name = name
        self.monthly = monthly
    }
}

/// How a logged model id was priced.
public struct PriceMatch: Sendable, Equatable {
    /// The model's prices, oldest first.
    public var prices: [ModelPrice]
    /// False when the id is not in the list and the closest model of its family stands in.
    public var exact: Bool

    /// The price in effect on a day.
    public func price(on day: Day) -> ModelPrice {
        var pick = prices[0]
        for p in prices.dropFirst() {
            if let since = p.sinceDay, since <= day { pick = p }
        }
        return pick
    }

    /// The model's current name.
    public var name: String { prices[prices.count - 1].name }
}

/// Looks up prices for model ids as the tools log them, and remembers the answers.
public final class Pricer: @unchecked Sendable {
    public let list: PriceList
    private var byId: [String: [ModelPrice]] = [:]
    private var cache: [String: PriceMatch?] = [:]
    private let lock = NSLock()

    public init(list: PriceList) {
        self.list = list
        var grouped: [String: [ModelPrice]] = [:]
        for m in list.models { grouped[Pricer.normalize(m.id), default: []].append(m) }
        for (key, prices) in grouped {
            byId[key] = prices.sorted { ($0.sinceDay ?? Day(rawValue: 0)) < ($1.sinceDay ?? Day(rawValue: 0)) }
        }
        for m in list.models {
            for alias in m.aliases ?? [] {
                let key = Pricer.normalize(alias)
                if byId[key] == nil { byId[key] = byId[Pricer.normalize(m.id)] }
            }
        }
    }

    /// The price for a logged model id, or nil when clai has no price for it.
    public func match(_ model: String) -> PriceMatch? {
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[model] { return cached }
        let found = lookup(model)
        cache[model] = found
        return found
    }

    /// A readable model name: the price list's, or the id itself.
    public func displayName(_ model: String) -> String {
        if let m = match(model), m.exact { return m.name }
        return model.isEmpty ? "Unknown model" : model
    }

    private func lookup(_ raw: String) -> PriceMatch? {
        let id = Pricer.normalize(raw)
        guard !id.isEmpty else { return nil }
        if let m = byId[id] { return PriceMatch(prices: m, exact: true) }
        // `gpt-5.2-codex-high` -> `gpt-5.2-codex`, `claude-sonnet-4-5-thinking` -> `claude-sonnet-4-5`:
        // drop trailing words that never change the price. Words like `mini` or `lite` do, and a
        // version number is never dropped (`claude-opus-5-6` is not `claude-opus-5`).
        var parts = id.split(separator: "-").map(String.init)
        while parts.count > 2, let last = parts.last, Pricer.priceNeutralWords.contains(last) {
            parts.removeLast()
            if let m = byId[parts.joined(separator: "-")] { return PriceMatch(prices: m, exact: true) }
        }
        // A newer or older version of a known family: the nearest known version at or below it.
        return familyFallback(id)
    }

    private func familyFallback(_ id: String) -> PriceMatch? {
        let target = Pricer.family(of: id)
        guard !target.version.isEmpty else { return nil }
        var best: (String, [Int])?
        var oldest: (String, [Int])?
        for (key, _) in byId where byId[key]?.first.map({ Pricer.normalize($0.id) == key }) == true {
            let f = Pricer.family(of: key)
            guard f.name == target.name, !f.version.isEmpty else { continue }
            if f.version.lexicographicallyPrecedes(target.version) || f.version == target.version {
                if best == nil || best!.1.lexicographicallyPrecedes(f.version) { best = (key, f.version) }
            }
            if oldest == nil || f.version.lexicographicallyPrecedes(oldest!.1) { oldest = (key, f.version) }
        }
        guard let pick = best ?? oldest, let prices = byId[pick.0] else { return nil }
        return PriceMatch(prices: prices, exact: false)
    }

    /// Trailing words of a model id that name a setting, not a differently priced model.
    static let priceNeutralWords: Set<String> = [
        "latest", "thinking", "reasoning", "minimal", "low", "medium", "high", "xhigh",
        "preview", "exp", "experimental", "chat",
    ]

    /// Lowercases and strips what does not change the price: provider and region prefixes,
    /// release dates, Bedrock and Vertex version suffixes, context-size tags like `[1m]`.
    public static func normalize(_ raw: String) -> String {
        var id = raw.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if let bracket = id.firstIndex(of: "[") { id = String(id[..<bracket]) }
        if let slash = id.lastIndex(of: "/") { id = String(id[id.index(after: slash)...]) }
        if let at = id.firstIndex(of: "@") { id = String(id[..<at]) }
        for prefix in ["us.", "eu.", "apac.", "au.", "jp.", "global."] where id.hasPrefix(prefix + "anthropic.") {
            id.removeFirst(prefix.count)
        }
        if id.hasPrefix("anthropic.") { id.removeFirst("anthropic.".count) }
        if id.hasPrefix("models/") { id.removeFirst("models/".count) }
        // Bedrock: `-v1:0`, `-v2:0`
        if let range = id.range(of: #"-v\d+(:\d+)?$"#, options: .regularExpression) { id.removeSubrange(range) }
        // Dates: `-20250929`, `-2025-08-07`
        if let range = id.range(of: #"-\d{8}$"#, options: .regularExpression) { id.removeSubrange(range) }
        if let range = id.range(of: #"-\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) { id.removeSubrange(range) }
        // Preview snapshots: `gemini-2.5-flash-preview-05-20` -> `gemini-2.5-flash-preview`
        if let range = id.range(of: #"-preview-\d{2}-\d{2}$"#, options: .regularExpression) {
            id.replaceSubrange(range, with: "-preview")
        }
        // `claude-sonnet-4.5` (OpenRouter, OpenCode, Copilot) -> `claude-sonnet-4-5`
        if id.hasPrefix("claude") { id = id.replacingOccurrences(of: ".", with: "-") }
        return id.trimmingCharacters(in: CharacterSet(charactersIn: "-:. "))
    }

    /// A model id's family (its words) and version (its numbers):
    /// `claude-opus-4-5` -> (`claude-opus`, [4, 5]); `claude-3-5-sonnet` -> (`claude-sonnet`, [3, 5]);
    /// `gpt-5.2-codex` -> (`gpt-codex`, [5, 2]); `gemini-2.5-flash-lite` -> (`gemini-flash-lite`, [2, 5]).
    static func family(of id: String) -> (name: String, version: [Int]) {
        var words: [String] = []
        var version: [Int] = []
        for part in id.split(separator: "-") {
            let pieces = part.split(separator: ".")
            let numbers = pieces.compactMap { Int($0) }
            if !pieces.isEmpty, numbers.count == pieces.count {
                version.append(contentsOf: numbers)
            } else {
                words.append(String(part))
            }
        }
        return (words.joined(separator: "-"), version)
    }
}
