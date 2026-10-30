import Foundation

// The price list compiled into the app. USD per million tokens, checked on 2026-10-30 against:
//   Anthropic  https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI     https://developers.openai.com/api/docs/pricing
//   Google     https://ai.google.dev/gemini-api/docs/pricing
// apps/site/public/prices.json is the same list (a test keeps them equal). The app fetches it once a
// day, so a price change or a new model reaches every copy without an app update.

/// Rates rounded to a millionth of a dollar, so the published list reads `0.3`, not `0.30000000000000004`.
private func rates(_ input: Double, _ output: Double, read: Double?, write: Double? = nil, write1h: Double? = nil) -> Rates {
    func clean(_ value: Double) -> Double { (value * 1_000_000).rounded() / 1_000_000 }
    return Rates(input: clean(input), output: clean(output), cacheRead: read.map(clean), cacheWrite: write.map(clean), cacheWrite1h: write1h.map(clean))
}

/// Anthropic: 5-minute cache writes 1.25x input, 1-hour writes 2x, reads 0.1x unless given.
private func claude(_ id: String, _ name: String, _ input: Double, _ output: Double, read: Double? = nil,
                    aliases: [String]? = nil, longAbove: Int64? = nil, long: (Double, Double, Double)? = nil,
                    fast: Double? = nil, since: String? = nil) -> ModelPrice {
    func tier(_ i: Double, _ o: Double, _ r: Double?) -> Rates {
        rates(i, o, read: r ?? i * 0.1, write: i * 1.25, write1h: i * 2)
    }
    var longContext: ModelPrice.LongContext?
    if let longAbove, let long { longContext = .init(above: longAbove, rates: tier(long.0, long.1, long.2)) }
    return ModelPrice(id: id, name: name, aliases: aliases, rates: tier(input, output, read), long: longContext, fast: fast, since: since)
}

/// OpenAI: cached input at its own rate. From GPT-5.6 on, cache writes cost 1.25x input (`writes`).
/// GPT-5.4 and later bill a request with more than 272K input tokens at 2x input and cache rates
/// and 1.5x output (`longContext`).
private func openai(_ id: String, _ name: String, _ input: Double, _ output: Double, read: Double?,
                    writes: Bool = false, longContext: Bool = false, fast: Double? = nil, aliases: [String]? = nil) -> ModelPrice {
    let write = writes ? input * 1.25 : nil
    let long = longContext ? ModelPrice.LongContext(
        above: 272_000,
        rates: rates(input * 2, output * 1.5, read: read.map { $0 * 2 }, write: write.map { $0 * 2 })
    ) : nil
    return ModelPrice(id: id, name: name, aliases: aliases, rates: rates(input, output, read: read, write: write), long: long, fast: fast)
}

/// Google: thinking tokens are output; some models bill prompts over 200K tokens higher.
private func gemini(_ id: String, _ name: String, _ input: Double, _ output: Double, read: Double?,
                    long: (Double, Double, Double)? = nil, aliases: [String]? = nil, since: String? = nil) -> ModelPrice {
    let tier = long.map { ModelPrice.LongContext(above: 200_000, rates: rates($0.0, $0.1, read: $0.2)) }
    return ModelPrice(id: id, name: name, aliases: aliases, rates: rates(input, output, read: read), long: tier, since: since)
}

extension PriceList {
    public static let builtIn = PriceList(
        version: "2026-10-30",
        webSearchPer1k: 10,
        models: [
            // MARK: Anthropic
            claude("claude-fable-5-1", "Claude Fable 5.1", 10, 50, read: 0.25),
            claude("claude-mythos-5-1", "Claude Mythos 5.1", 10, 50, read: 0.25),
            claude("claude-fable-5", "Claude Fable 5", 10, 50, read: 1),
            claude("claude-mythos-5", "Claude Mythos 5", 10, 50, read: 1),
            claude("claude-mythos-preview", "Claude Mythos Preview", 25, 125),
            claude("claude-opus-5-5", "Claude Opus 5.5", 4, 20, read: 0.2, fast: 2),
            claude("claude-opus-5", "Claude Opus 5", 5, 25, fast: 2),
            claude("claude-opus-4-8", "Claude Opus 4.8", 5, 25, fast: 2),
            claude("claude-opus-4-7", "Claude Opus 4.7", 5, 25, fast: 6),
            claude("claude-opus-4-6", "Claude Opus 4.6", 5, 25, fast: 6),
            claude("claude-opus-4-5", "Claude Opus 4.5", 5, 25),
            claude("claude-opus-4-1", "Claude Opus 4.1", 15, 75),
            claude("claude-opus-4", "Claude Opus 4", 15, 75, aliases: ["claude-opus-4-0"]),
            claude("claude-3-opus", "Claude Opus 3", 15, 75),
            claude("claude-sonnet-5-5", "Claude Sonnet 5.5", 2, 10, read: 0.2),
            claude("claude-sonnet-5-5", "Claude Sonnet 5.5", 2, 10, read: 0.1, since: "2026-10-07"),
            claude("claude-sonnet-5", "Claude Sonnet 5", 2, 10, read: 0.2),
            claude("claude-sonnet-4-6", "Claude Sonnet 4.6", 3, 15),
            // Sonnet 4 and 4.5 billed prompts over 200K higher while their 1M-context beta ran.
            claude("claude-sonnet-4-5", "Claude Sonnet 4.5", 3, 15, longAbove: 200_000, long: (6, 22.5, 0.6)),
            claude("claude-sonnet-4", "Claude Sonnet 4", 3, 15, aliases: ["claude-sonnet-4-0"], longAbove: 200_000, long: (6, 22.5, 0.6)),
            claude("claude-3-7-sonnet", "Claude Sonnet 3.7", 3, 15),
            claude("claude-3-5-sonnet", "Claude Sonnet 3.5", 3, 15),
            claude("claude-haiku-5-5", "Claude Haiku 5.5", 0.1, 0.5, read: 0.01, longAbove: 100_000, long: (0.5, 2.5, 0.05)),
            claude("claude-haiku-4-5", "Claude Haiku 4.5", 1, 5),
            claude("claude-3-5-haiku", "Claude Haiku 3.5", 0.8, 4),
            claude("claude-3-haiku", "Claude Haiku 3", 0.25, 1.25, read: 0.03),

            // MARK: OpenAI
            openai("gpt-6-astra", "GPT-6 Astra", 10, 50, read: 1, writes: true, longContext: true, fast: 2),
            openai("gpt-6.1-sol", "GPT-6.1 Sol", 2, 10, read: 0.1, writes: true, longContext: true, fast: 2),
            openai("gpt-6.1-terra", "GPT-6.1 Terra", 1, 5, read: 0.05, writes: true, longContext: true, fast: 2),
            openai("gpt-6-sol", "GPT-6 Sol", 2, 10, read: 0.2, writes: true, longContext: true, fast: 2),
            openai("gpt-6-luna", "GPT-6 Luna", 0.1, 0.5, read: 0.01, writes: true, longContext: true, fast: 2),
            openai("gpt-5.6-sol", "GPT-5.6 Sol", 4, 20, read: 0.4, writes: true, longContext: true, fast: 2, aliases: ["gpt-5.6"]),
            openai("gpt-5.6-terra", "GPT-5.6 Terra", 2, 12, read: 0.2, writes: true, longContext: true, fast: 2),
            openai("gpt-5.6-luna", "GPT-5.6 Luna", 0.2, 1.2, read: 0.02, writes: true, longContext: true, fast: 2),
            openai("gpt-5.5", "GPT-5.5", 5, 30, read: 0.5, longContext: true, fast: 2.5),
            openai("gpt-5.5-pro", "GPT-5.5 pro", 30, 180, read: nil, longContext: true),
            openai("gpt-5.4", "GPT-5.4", 2.5, 15, read: 0.25, longContext: true, fast: 2),
            openai("gpt-5.4-pro", "GPT-5.4 pro", 30, 180, read: nil, longContext: true),
            openai("gpt-5.4-mini", "GPT-5.4 mini", 0.75, 4.5, read: 0.075, fast: 2),
            openai("gpt-5.4-nano", "GPT-5.4 nano", 0.2, 1.25, read: 0.02),
            openai("gpt-5.3-codex", "GPT-5.3-Codex", 1.75, 14, read: 0.175, fast: 2),
            openai("gpt-5.2", "GPT-5.2", 1.75, 14, read: 0.175, fast: 2, aliases: ["gpt-5.2-codex"]),
            openai("gpt-5.1", "GPT-5.1", 1.25, 10, read: 0.125, fast: 2, aliases: ["gpt-5.1-codex", "gpt-5.1-codex-max"]),
            openai("gpt-5.1-codex-mini", "GPT-5.1-Codex mini", 0.25, 2, read: 0.025),
            openai("gpt-5", "GPT-5", 1.25, 10, read: 0.125, fast: 2, aliases: ["gpt-5-codex"]),
            openai("gpt-5-mini", "GPT-5 mini", 0.25, 2, read: 0.025, fast: 1.8),
            openai("gpt-5-nano", "GPT-5 nano", 0.05, 0.4, read: 0.005),
            openai("codex-mini-latest", "codex-mini", 1.5, 6, read: 0.375),
            openai("o3", "o3", 2, 8, read: 0.5, fast: 1.75),
            openai("o4-mini", "o4-mini", 1.1, 4.4, read: 0.275, fast: 1.82),
            openai("gpt-4.1", "GPT-4.1", 2, 8, read: 0.5, fast: 1.75),
            openai("gpt-4.1-mini", "GPT-4.1 mini", 0.4, 1.6, read: 0.1),
            openai("gpt-4o", "GPT-4o", 2.5, 10, read: 1.25),
            openai("gpt-4o-mini", "GPT-4o mini", 0.15, 0.6, read: 0.075),

            // MARK: Google
            gemini("gemini-4-argon", "Gemini 4 Argon", 2, 10, read: 0.1),
            gemini("gemini-4-argon", "Gemini 4 Argon", 4, 20, read: 0.2, since: "2026-12-01"),
            gemini("gemini-3.1-pro-preview", "Gemini 3.1 Pro", 2, 12, read: 0.2, long: (4, 18, 0.4),
                   aliases: ["gemini-3-pro-preview", "gemini-3.1-pro-preview-customtools", "gemini-3-pro"]),
            gemini("gemini-3.8-flash", "Gemini 3.8 Flash", 0.75, 3.75, read: 0.075),
            gemini("gemini-3.8-flash", "Gemini 3.8 Flash", 1.5, 7.5, read: 0.15, since: "2027-01-01"),
            gemini("gemini-3.7-flash", "Gemini 3.7 Flash", 0.75, 3.75, read: 0.075),
            gemini("gemini-3.6-flash", "Gemini 3.6 Flash", 0.75, 3.75, read: 0.075),
            gemini("gemini-3.6-flash", "Gemini 3.6 Flash", 1.5, 7.5, read: 0.15, since: "2027-01-01"),
            gemini("gemini-3.5-flash", "Gemini 3.5 Flash", 1.5, 9, read: 0.15),
            gemini("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", 0.3, 2.5, read: 0.03),
            gemini("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", 0.25, 1.5, read: 0.025),
            gemini("gemini-3-flash-preview", "Gemini 3 Flash", 0.5, 3, read: 0.05, aliases: ["gemini-3-flash"]),
            gemini("gemini-2.5-pro", "Gemini 2.5 Pro", 1.25, 10, read: 0.125, long: (2.5, 15, 0.25)),
            gemini("gemini-2.5-flash", "Gemini 2.5 Flash", 0.3, 2.5, read: 0.03),
            gemini("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite", 0.1, 0.4, read: 0.01),
            gemini("gemini-2.0-flash", "Gemini 2.0 Flash", 0.15, 0.6, read: nil),
        ],
        plans: [
            Plan(id: "claude-pro", vendor: .anthropic, name: "Claude Pro", monthly: 20),
            Plan(id: "claude-max-5x", vendor: .anthropic, name: "Claude Max 5x", monthly: 100),
            Plan(id: "claude-max-20x", vendor: .anthropic, name: "Claude Max 20x", monthly: 200),
            Plan(id: "claude-team", vendor: .anthropic, name: "Claude Team", monthly: 25),
            Plan(id: "claude-team-premium", vendor: .anthropic, name: "Claude Team Premium", monthly: 125),
            Plan(id: "chatgpt-go", vendor: .openai, name: "ChatGPT Go", monthly: 8),
            Plan(id: "chatgpt-plus", vendor: .openai, name: "ChatGPT Plus", monthly: 20),
            Plan(id: "chatgpt-pro-100", vendor: .openai, name: "ChatGPT Pro ($100)", monthly: 100),
            Plan(id: "chatgpt-pro-200", vendor: .openai, name: "ChatGPT Pro ($200)", monthly: 200),
            Plan(id: "chatgpt-pro-500", vendor: .openai, name: "ChatGPT Pro ($500)", monthly: 500),
            Plan(id: "chatgpt-business", vendor: .openai, name: "ChatGPT Business", monthly: 25),
            Plan(id: "google-ai-plus", vendor: .google, name: "Google AI Plus", monthly: 4.99),
            Plan(id: "google-ai-pro", vendor: .google, name: "Google AI Pro", monthly: 19.99),
            Plan(id: "google-ai-ultra", vendor: .google, name: "Google AI Ultra ($99.99)", monthly: 99.99),
            Plan(id: "google-ai-ultra-200", vendor: .google, name: "Google AI Ultra ($199.99)", monthly: 199.99),
        ]
    )
}
