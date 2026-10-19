import Foundation

/// Display names for provider ids, as in packages/core/src/labels.ts.
public enum Providers {
    private static let labels: [String: String] = [
        "anthropic": "Anthropic",
        "openai": "OpenAI",
        "google": "Google",
        "xai": "xAI",
        "mistral": "Mistral",
        "deepseek": "DeepSeek",
        "cohere": "Cohere",
        "perplexity": "Perplexity",
        "meta": "Meta",
        "amazon": "Amazon",
        "openrouter": "OpenRouter",
        "cursor": "Cursor",
        "github": "GitHub Copilot",
        "microsoft": "Microsoft",
        "other": "Other",
    ]

    public static func label(_ provider: String) -> String {
        labels[provider] ?? provider
    }

    public struct PlanGroup: Identifiable, Equatable, Sendable {
        public var provider: String
        public var label: String
        public var options: [Snapshot.PlanOption]
        public var id: String { provider }
    }

    /// Plan options grouped by provider, in the catalog's order.
    public static func group(_ options: [Snapshot.PlanOption]) -> [PlanGroup] {
        var order: [String] = []
        var byProvider: [String: [Snapshot.PlanOption]] = [:]
        for option in options {
            if byProvider[option.provider] == nil { order.append(option.provider) }
            byProvider[option.provider, default: []].append(option)
        }
        return order.map { PlanGroup(provider: $0, label: label($0), options: byProvider[$0] ?? []) }
    }
}
