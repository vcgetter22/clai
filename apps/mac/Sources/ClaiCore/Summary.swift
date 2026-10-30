import Foundation

/// How a model's cost was worked out.
public enum PriceBasis: Sendable, Equatable {
    /// At the model's list price.
    case listed
    /// The model is not in the price list; priced like the closest model of its family.
    case estimated(like: String)
    /// clai has no price; the tool's own logged cost is shown.
    case logged
    /// No price at all; counted as $0.
    case unpriced
}

/// Everything the menu bar and the panel show, computed from the ledger.
public struct Summary: Sendable, Equatable {
    public struct DayTotal: Sendable, Equatable, Identifiable {
        public var day: Day
        public var cost: Double
        public var tokens: Int64
        public var id: Int32 { day.rawValue }
    }

    public struct ToolTotal: Sendable, Equatable, Identifiable {
        public var tool: Tool
        public var cost: Double
        public var tokens: Int64
        public var requests: Int
        public var id: String { tool.rawValue }
    }

    public struct ModelTotal: Sendable, Equatable, Identifiable {
        /// The model id as logged.
        public var model: String
        public var name: String
        public var cost: Double
        public var tokens: Int64
        public var requests: Int
        public var basis: PriceBasis
        public var tools: [Tool]
        public var id: String { model }
    }

    public var today: Day
    public var todayCost: Double
    public var monthCost: Double
    public var lastMonthCost: Double
    public var monthTokens: Int64
    public var monthRequests: Int
    /// This month's cost if the rest of the month goes like the days so far; nil in its first days.
    public var projectedMonthCost: Double?
    /// The last 30 days, oldest first, days without usage included.
    public var days: [DayTotal]
    /// This month by tool and by model, most expensive first.
    public var tools: [ToolTotal]
    public var models: [ModelTotal]
    /// This month's cost per vendor, for plan value.
    public var vendorMonthCost: [Vendor: Double]
    /// The last day with any usage, nil before the first.
    public var lastUsageDay: Day?

    public var isEmpty: Bool { lastUsageDay == nil }

    public static func empty(today: Day) -> Summary {
        Summary(today: today, todayCost: 0, monthCost: 0, lastMonthCost: 0, monthTokens: 0, monthRequests: 0,
                projectedMonthCost: nil, days: chartDays(ending: today, count: 30, costs: [:], tokens: [:]),
                tools: [], models: [], vendorMonthCost: [:], lastUsageDay: nil)
    }

    public static func make(ledger: Ledger, pricer: Pricer, today: Day, chartLength: Int = 30) -> Summary {
        let monthStart = today.monthStart
        let lastMonthStart = today.previousMonthStart
        let chartStart = today.adding(days: -(chartLength - 1))

        var todayCost = 0.0, monthCost = 0.0, lastMonthCost = 0.0
        var monthTokens: Int64 = 0
        var monthRequests = 0
        var dayCost: [Day: Double] = [:]
        var dayTokens: [Day: Int64] = [:]
        var tools: [Tool: ToolTotal] = [:]
        var models: [String: ModelTotal] = [:]
        var vendors: [Vendor: Double] = [:]
        var lastUsage: Day?

        for (key, value) in ledger.buckets where value.requests > 0 {
            let (cost, basis) = price(key, value, pricer: pricer)
            if lastUsage == nil || key.day > lastUsage! { lastUsage = key.day }
            if key.day == today { todayCost += cost }
            if key.day >= chartStart && key.day <= today {
                dayCost[key.day, default: 0] += cost
                dayTokens[key.day, default: 0] += value.tokens.total
            }
            if key.day.isSameMonth(as: lastMonthStart) { lastMonthCost += cost }
            guard key.day.isSameMonth(as: today), key.day >= monthStart else { continue }
            monthCost += cost
            monthTokens += value.tokens.total
            monthRequests += value.requests
            vendors[key.tool.vendor, default: 0] += cost

            var tool = tools[key.tool] ?? ToolTotal(tool: key.tool, cost: 0, tokens: 0, requests: 0)
            tool.cost += cost
            tool.tokens += value.tokens.total
            tool.requests += value.requests
            tools[key.tool] = tool

            var model = models[key.model] ?? ModelTotal(model: key.model, name: pricer.displayName(key.model), cost: 0, tokens: 0, requests: 0, basis: basis, tools: [])
            model.cost += cost
            model.tokens += value.tokens.total
            model.requests += value.requests
            if !model.tools.contains(key.tool) { model.tools.append(key.tool); model.tools.sort() }
            models[key.model] = model
        }

        var projected: Double?
        if today.day >= 3 {
            let length = CivilDate.daysFromCivil(year: today.month == 12 ? today.year + 1 : today.year, month: today.month == 12 ? 1 : today.month + 1, day: 1) - monthStart.ordinal
            projected = monthCost / Double(today.day) * Double(length)
        }

        return Summary(
            today: today,
            todayCost: todayCost,
            monthCost: monthCost,
            lastMonthCost: lastMonthCost,
            monthTokens: monthTokens,
            monthRequests: monthRequests,
            projectedMonthCost: projected,
            days: chartDays(ending: today, count: chartLength, costs: dayCost, tokens: dayTokens),
            tools: tools.values.sorted { ($0.cost, $0.tokens) > ($1.cost, $1.tokens) },
            models: models.values.sorted { ($0.cost, $0.tokens) > ($1.cost, $1.tokens) },
            vendorMonthCost: vendors,
            lastUsageDay: lastUsage
        )
    }

    /// The cost of one ledger line and how it was priced.
    static func price(_ key: BucketKey, _ value: BucketValue, pricer: Pricer) -> (Double, PriceBasis) {
        if let match = pricer.match(key.model) {
            let cost = match.price(on: key.day).cost(of: value.tokens, long: key.long, fast: key.fast)
                + Double(value.webSearches) * pricer.list.webSearchPer1k / 1000
            return (cost, match.exact ? .listed : .estimated(like: match.name))
        }
        if value.loggedCost > 0 { return (value.loggedCost, .logged) }
        return (0, .unpriced)
    }

    private static func chartDays(ending today: Day, count: Int, costs: [Day: Double], tokens: [Day: Int64]) -> [DayTotal] {
        (0..<count).map { offset in
            let day = today.adding(days: offset - (count - 1))
            return DayTotal(day: day, cost: costs[day] ?? 0, tokens: tokens[day] ?? 0)
        }
    }
}
