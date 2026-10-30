import Foundation

/// How a model's cost was worked out.
public enum PriceBasis: Sendable, Equatable {
    /// At the model's list price.
    case listed
    /// The model is not in the price list; priced like the closest model of its family.
    case estimated(like: String)
    /// clai has no price; the tool's own logged cost is shown.
    case logged
    /// No price at all: the requests are counted, their cost is unknown (never shown as $0).
    case unpriced

    /// Which basis describes a model whose lines were priced differently: a list price over a
    /// logged cost over none.
    func combined(with other: PriceBasis) -> PriceBasis {
        func rank(_ basis: PriceBasis) -> Int {
            switch basis {
            case .listed, .estimated: return 2
            case .logged: return 1
            case .unpriced: return 0
            }
        }
        return rank(other) > rank(self) ? other : self
    }
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
        /// Requests of models clai has no price for; not in `cost`.
        public var unpricedRequests: Int
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
        /// Requests without a price (no list price and no logged cost); not in `cost`.
        public var unpricedRequests: Int
        public var tools: [Tool]
        public var id: String { model }
    }

    public var today: Day
    public var todayCost: Double
    public var monthCost: Double
    public var lastMonthCost: Double
    public var monthTokens: Int64
    public var monthRequests: Int
    /// Requests without a price, which no cost above includes.
    public var todayUnpriced: Int
    public var monthUnpriced: Int
    public var lastMonthUnpriced: Int
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
                todayUnpriced: 0, monthUnpriced: 0, lastMonthUnpriced: 0, projectedMonthCost: nil, days: chartDays(ending: today, count: 30, costs: [:], tokens: [:]),
                tools: [], models: [], vendorMonthCost: [:], lastUsageDay: nil)
    }

    /// The summary at `now` (seconds since 1970), with days in `days`' time zone.
    public static func make(ledger: Ledger, pricer: Pricer, now: Double, days: inout DayResolver, chartLength: Int = 30) -> Summary {
        let today = days.day(at: now)
        let monthStart = today.monthStart
        let lastMonthStart = today.previousMonthStart
        let chartStart = today.adding(days: -(chartLength - 1))
        // Quarter hours before last month (with a day to spare for any time zone) only tell when
        // usage was last seen.
        let earliest = Quarter(time: Double(min(lastMonthStart.ordinal, chartStart.ordinal) - 1) * 86_400)

        var todayCost = 0.0, monthCost = 0.0, lastMonthCost = 0.0
        var todayUnpriced = 0, monthUnpriced = 0, lastMonthUnpriced = 0
        var monthTokens: Int64 = 0
        var monthRequests = 0
        var dayCost: [Day: Double] = [:]
        var dayTokens: [Day: Int64] = [:]
        var tools: [Tool: ToolTotal] = [:]
        var models: [String: ModelTotal] = [:]
        var vendors: [Vendor: Double] = [:]
        var latest: Quarter?

        for (key, value) in ledger.buckets where value.requests > 0 {
            if latest == nil || key.quarter > latest! { latest = key.quarter }
            guard key.quarter >= earliest else { continue }
            let day = days.day(at: key.quarter.start)
            let (cost, basis) = price(key, value, on: day, pricer: pricer)
            let unpriced = basis == .unpriced ? value.requests : 0
            if day == today {
                todayCost += cost
                todayUnpriced += unpriced
            }
            if day >= chartStart && day <= today {
                dayCost[day, default: 0] += cost
                dayTokens[day, default: 0] += value.tokens.total
            }
            if day.isSameMonth(as: lastMonthStart) {
                lastMonthCost += cost
                lastMonthUnpriced += unpriced
            }
            guard day.isSameMonth(as: today), day >= monthStart else { continue }
            monthCost += cost
            monthUnpriced += unpriced
            monthTokens += value.tokens.total
            monthRequests += value.requests
            vendors[key.tool.vendor, default: 0] += cost

            var tool = tools[key.tool] ?? ToolTotal(tool: key.tool, cost: 0, tokens: 0, requests: 0, unpricedRequests: 0)
            tool.cost += cost
            tool.tokens += value.tokens.total
            tool.requests += value.requests
            tool.unpricedRequests += unpriced
            tools[key.tool] = tool

            var model = models[key.model]
                ?? ModelTotal(model: key.model, name: pricer.displayName(key.model), cost: 0, tokens: 0, requests: 0,
                              basis: basis, unpricedRequests: 0, tools: [])
            model.cost += cost
            model.tokens += value.tokens.total
            model.requests += value.requests
            model.unpricedRequests += unpriced
            model.basis = model.basis.combined(with: basis)
            if !model.tools.contains(key.tool) { model.tools.append(key.tool); model.tools.sort() }
            models[key.model] = model
        }
        let lastUsage = latest.map { days.day(at: $0.start) }

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
            todayUnpriced: todayUnpriced,
            monthUnpriced: monthUnpriced,
            lastMonthUnpriced: lastMonthUnpriced,
            projectedMonthCost: projected,
            days: chartDays(ending: today, count: chartLength, costs: dayCost, tokens: dayTokens),
            tools: tools.values.sorted { ($0.cost, $0.tokens, $0.tool.rawValue) > ($1.cost, $1.tokens, $1.tool.rawValue) },
            models: models.values.sorted { ($0.cost, $0.tokens, $0.model) > ($1.cost, $1.tokens, $1.model) },
            vendorMonthCost: vendors,
            lastUsageDay: lastUsage
        )
    }

    /// The cost of one ledger line and how it was priced.
    static func price(_ key: BucketKey, _ value: BucketValue, on day: Day, pricer: Pricer) -> (Double, PriceBasis) {
        if let match = pricer.match(key.model) {
            let cost = match.price(on: day).cost(of: value.tokens, long: key.long, fast: key.fast)
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
