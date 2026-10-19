import Foundation

/// The document `clai snapshot` prints (apps/server/src/snapshot.ts, schema 1). Amounts are USD,
/// days are `YYYY-MM-DD` in the engine's time zone, months are `YYYY-MM`.
public struct Snapshot: Codable, Equatable, Sendable {
    public static let supportedSchema = 1

    public var schema: Int
    public var generatedAt: String
    public var engineVersion: String
    public var timeZone: String
    public var pricingVersion: String
    public var events: EventSpan
    public var scan: Scan?
    public var today: Day
    public var yesterday: Day
    public var last7Days: Period
    public var month: Month
    public var lastMonth: KeyedPeriod
    public var forecast: Forecast
    public var daily: [DailyPoint]
    public var providers: [Slice]
    public var tools: [Slice]
    public var models: [Slice]
    public var projects: [Slice]
    public var plans: [Plan]
    public var budgets: [Budget]
    public var insights: [Insight]
    public var planOptions: [PlanOption]

    public struct EventSpan: Codable, Equatable, Sendable {
        public var total: Int
        public var first: String?
        public var last: String?
    }

    public struct Scan: Codable, Equatable, Sendable {
        public var durationMs: Double
        public var inserted: Int
        public var sources: [Source]
        public var watchPaths: [String]
    }

    public struct Source: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var label: String
        public var found: Bool
        public var summary: String
        public var inserted: Int
        public var error: String?
    }

    public struct Period: Codable, Equatable, Sendable {
        public var usd: Double
        public var events: Int
    }

    public struct Day: Codable, Equatable, Sendable {
        public var day: String
        public var usd: Double
        public var events: Int
    }

    public struct KeyedPeriod: Codable, Equatable, Sendable {
        public var key: String
        public var usd: Double
        public var events: Int
    }

    public struct Month: Codable, Equatable, Sendable {
        public var key: String
        public var usd: Double
        public var events: Int
        public var daysElapsed: Int
        public var daysInMonth: Int
        public var tokens: Double
        public var billedUsd: Double?
        public var basis: String

        public var basisKind: Basis { Basis(rawValue: basis) ?? .apiEquivalent }
        /// How far through the month we are, 0...1.
        public var elapsedFraction: Double { daysInMonth > 0 ? min(1, Double(daysElapsed) / Double(daysInMonth)) : 0 }
    }

    public struct Forecast: Codable, Equatable, Sendable {
        public var projectedUsd: Double
        public var avgDailyUsd: Double
        public var deltaVsLastMonth: Double?
        public var method: String
        public var confidence: String

        public var hasEnoughData: Bool { method != "insufficient-data" }
    }

    public struct DailyPoint: Codable, Equatable, Sendable, Identifiable {
        public var day: String
        public var usd: Double
        public var events: Int
        public var byProvider: [String: Double]
        public var id: String { day }
    }

    public struct Slice: Codable, Equatable, Sendable, Identifiable {
        public var key: String
        public var label: String
        public var provider: String?
        public var usd: Double
        public var share: Double
        public var events: Int
        public var tokens: Double
        public var id: String { key }
    }

    public struct Plan: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var provider: String
        public var plan: String
        public var label: String
        public var priceMonthly: Double
        public var mtdUsd: Double
        public var projectedUsd: Double
        public var lastMonthUsd: Double
        public var multiple: Double
    }

    public struct Budget: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var amountUsd: Double
        public var mtdUsd: Double
        public var projectedUsd: Double
        public var usedPct: Double
        public var projectedPct: Double

        public var status: BudgetStatus {
            if usedPct >= 1 { return .over }
            if projectedPct > 1 { return .onPaceToExceed }
            return .fine
        }
    }

    public struct Insight: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var kind: String
        public var severity: String
        public var title: String
        public var detail: String
        public var action: String?
        public var impactUsdPerMonth: Double?

        public var level: Severity { Severity(rawValue: severity) ?? .info }
    }

    public struct PlanOption: Codable, Equatable, Sendable, Identifiable, Hashable {
        public var provider: String
        public var plan: String
        public var label: String
        public var priceMonthly: Double
        public var id: String { "\(provider):\(plan)" }
    }

    /// Decode engine output, refusing schemas this build does not understand.
    public static func decode(_ data: Data) throws -> Snapshot {
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
        guard snapshot.schema == supportedSchema else { throw EngineError.unsupportedSchema(snapshot.schema) }
        return snapshot
    }

    /// True until the first usage event has been ingested.
    public var isEmpty: Bool { events.total == 0 }

    public var generatedDate: Date? { ISODate.parse(generatedAt) }

    /// The month name of `month.key`, e.g. "October".
    public var monthName: String { Format.monthName(month.key) }

    public var lastMonthName: String { Format.monthName(lastMonth.key) }

    public var foundSources: [Source] { scan?.sources.filter(\.found) ?? [] }
}

/// How a figure was arrived at (docs/design-principles.md rule 4).
public enum Basis: String, Sendable {
    case apiEquivalent = "api-equivalent"
    case billed
    case mixed

    public var label: String {
        switch self {
        case .apiEquivalent: return "API-equivalent"
        case .billed: return "Billed"
        case .mixed: return "Billed + API-equivalent"
        }
    }

    public var explanation: String {
        switch self {
        case .apiEquivalent: return "What the same tokens would cost at the provider's list prices."
        case .billed: return "Amounts the provider reported as billed."
        case .mixed: return "Billed amounts where providers report them, list prices for the rest."
        }
    }
}

public enum Severity: String, Sendable {
    case info, opportunity, warning, critical
}

public enum BudgetStatus: Sendable {
    case fine, onPaceToExceed, over
}

/// ISO-8601 instants as the engine writes them (`2026-10-19T15:00:00.000Z`).
public enum ISODate {
    public static func parse(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) { return date }
        return ISO8601DateFormatter().date(from: text)
    }
}
