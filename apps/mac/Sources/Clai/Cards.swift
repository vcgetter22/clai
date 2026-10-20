import AppKit
import Charts
import ClaiKit
import SwiftUI

// MARK: - Stat pills

/// Today, the last seven days, and what the declared plan is worth.
struct StatPills: View {
    let snapshot: Snapshot
    var onAddPlan: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            StatPill(title: "Today", value: Format.usd(snapshot.today.usd), detail: todayDetail)
                .help(todayHelp)
            StatPill(title: "7 days", value: Format.usd(snapshot.last7Days.usd), detail: "\(Format.usd(snapshot.last7Days.usd / 7)) a day")
            if let plan = snapshot.plans.first {
                StatPill(title: "Plan value", value: Format.multiple(plan.multiple), detail: plan.label, accent: true)
                    .help("\(plan.label) costs \(Format.usd(plan.priceMonthly)) a month; \(Format.usd(plan.mtdUsd)) of API-priced work went through it in \(snapshot.monthName) so far.")
            } else {
                Button(action: onAddPlan) {
                    StatPill(title: "Plan value", value: "Add plan", detail: "What it's worth", accent: true, isAction: true)
                }
                .buttonStyle(.plain)
                .help("Declare the plan you pay for (Claude Max, ChatGPT Plus, Cursor…) to see what it is worth at list prices.")
            }
        }
    }

    /// Yesterday's figure, or on a quiet stretch the day this Mac last logged usage, so a $0 day
    /// never reads like a fault.
    private var todayDetail: String {
        if snapshot.today.usd > 0 || snapshot.yesterday.usd > 0 { return "\(Format.usd(snapshot.yesterday.usd)) yesterday" }
        if let last = snapshot.lastUsageDay, last != snapshot.today.day { return "last use \(Format.dayLabel(last))" }
        return "none on this Mac"
    }

    private var todayHelp: String {
        if snapshot.today.usd > 0 { return "Today's usage by the AI tools on this Mac." }
        let last = snapshot.lastUsageDay.map { " The last usage logged here was on \(Format.dayLabel($0))." } ?? ""
        return "No AI tool on this Mac has logged usage today.\(last) Cloud sessions and claude.ai chats leave no logs on this Mac."
    }
}

struct StatPill: View {
    let title: String
    let value: String
    let detail: String
    var accent = false
    var isAction = false
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: isAction ? 15 : 17, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(accent ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Color.primary))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentTransition(.numericText())
            Text(detail)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .platter(cornerRadius: 16)
        .opacity(isAction && hovering ? 0.8 : 1)
        .animation(.easeOut(duration: 0.12), value: hovering)
        .onHover { hovering = isAction && $0 }
    }
}

// MARK: - Daily chart

/// Thirty days of spend, one bar a day, today at full strength. Hover reads a day out.
struct DailyChartCard: View {
    let snapshot: Snapshot
    @State private var selected: Date?

    private struct Bar: Identifiable {
        let id: String
        let date: Date
        let usd: Double
        let isToday: Bool
    }

    private var bars: [Bar] {
        snapshot.daily.compactMap { point in
            Format.dayDate(point.day).map { Bar(id: point.day, date: $0, usd: point.usd, isToday: point.day == snapshot.today.day) }
        }
    }

    private var selectedBar: Bar? {
        guard let selected else { return nil }
        return bars.min { abs($0.date.timeIntervalSince(selected)) < abs($1.date.timeIntervalSince(selected)) }
    }

    /// A label every 7 days, none in the last few days where it would run off the edge.
    private var ticks: [Date] {
        let all = bars
        return stride(from: 0, to: max(1, all.count - 3), by: 7).map { all[$0].date }
    }

    private var total: Double { snapshot.daily.reduce(0) { $0 + $1.usd } }
    private var peak: Double { snapshot.daily.map(\.usd).max() ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: "Last 30 days", trailing: selectedBar.map { "\(Format.dayLabel($0.id)) · \(Format.usd($0.usd))" } ?? "\(Format.usd(total)) total")
            chart
                .frame(height: 78)
        }
        .padding(12)
        .platter()
    }

    private var chart: some View {
        let highlighted = selectedBar?.id
        return Chart(bars) { bar in
            BarMark(x: .value("Day", bar.date, unit: .day), y: .value("Spend", bar.usd), width: .ratio(0.64))
                .foregroundStyle(style(for: bar, highlighted: highlighted))
                .cornerRadius(2)
        }
        .chartYScale(domain: 0...max(1, peak * 1.12))
        .chartXSelection(value: $selected)
        .chartXAxis {
            AxisMarks(values: ticks) { _ in
                AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                    .font(.system(size: 9, weight: .medium))
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 2)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                    .foregroundStyle(Color.primary.opacity(0.12))
                AxisValueLabel {
                    if let amount = value.as(Double.self) {
                        Text(Format.axisUsd(amount))
                            .font(.system(size: 9, weight: .medium))
                    }
                }
            }
        }
        .environment(\.timeZone, TimeZone(identifier: "UTC") ?? .current)
        .accessibilityLabel("Daily spend for the last 30 days, peak \(Format.usd(peak)).")
    }

    private func style(for bar: Bar, highlighted: String?) -> AnyShapeStyle {
        if bar.isToday || bar.id == highlighted { return AnyShapeStyle(Theme.accent) }
        return AnyShapeStyle(Theme.accent.opacity(highlighted == nil ? 0.45 : 0.28))
    }
}

// MARK: - Breakdown

/// Where this month's money went: by tool, model or project, plus the engine's tips.
struct BreakdownCard: View {
    let snapshot: Snapshot
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 10) {
            SegmentedTabs(tabs: BreakdownTab.allCases, selection: $model.breakdown, title: title)
            content
        }
        .padding(12)
        .platter()
    }

    private func title(_ tab: BreakdownTab) -> String {
        tab == .tips && !snapshot.insights.isEmpty ? "Tips \(snapshot.insights.count)" : tab.rawValue
    }

    @ViewBuilder
    private var content: some View {
        switch model.breakdown {
        case .tools: SliceList(slices: snapshot.tools, colorByProvider: true)
        case .models: SliceList(slices: snapshot.models, colorByProvider: true)
        case .projects: SliceList(slices: snapshot.projects, colorByProvider: false)
        case .tips: InsightList(insights: snapshot.insights)
        }
    }
}

struct SliceList: View {
    let slices: [Snapshot.Slice]
    let colorByProvider: Bool

    var body: some View {
        if slices.isEmpty {
            EmptyRow(text: "Nothing yet this month.")
        } else {
            VStack(spacing: 9) {
                ForEach(slices.prefix(4)) { slice in
                    SliceRow(slice: slice, color: colorByProvider ? Theme.provider(slice.provider) : Theme.accent)
                }
            }
        }
    }
}

struct SliceRow: View {
    let slice: Snapshot.Slice
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 8) {
                ProviderDot(color: color, size: 9)
                Text(slice.label)
                    .font(.system(size: 12.5, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 6)
                Text(Format.usd(slice.usd))
                    .font(.system(size: 12.5, weight: .semibold))
                    .monospacedDigit()
                Text(Format.percent(slice.share))
                    .font(.system(size: 11, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(width: 34, alignment: .trailing)
            }
            ShareBar(share: slice.share, color: color)
                .padding(.leading, 17)
        }
        .help("\(slice.label): \(Format.usd(slice.usd)) over \(slice.events) requests, \(Format.tokens(slice.tokens)) tokens")
    }
}

struct InsightList: View {
    let insights: [Snapshot.Insight]
    @Environment(AppModel.self) private var model

    var body: some View {
        if insights.isEmpty {
            EmptyRow(text: "No tips right now. clai looks at model mix, caching, context size and spikes.")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(insights.prefix(3)) { insight in
                    InsightRow(insight: insight)
                }
                Button("All insights in the dashboard") { model.openDashboard(page: "insights") }
                    .buttonStyle(.link)
                    .font(.system(size: 11, weight: .medium))
            }
        }
    }
}

struct InsightRow: View {
    let insight: Snapshot.Insight

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: insight.level.symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.severity(insight.level))
                .frame(width: 22, height: 22)
                .background(Circle().fill(Theme.severity(insight.level).opacity(0.14)))
            VStack(alignment: .leading, spacing: 2) {
                Text(insight.title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if let impact = insight.impactUsdPerMonth, impact > 0 {
                    Text("About \(Format.usd(impact)) a month")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(Theme.accent)
                }
            }
            Spacer(minLength: 0)
        }
        .help([insight.detail, insight.action].compactMap { $0 }.joined(separator: "\n\n"))
    }
}

struct EmptyRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .regular))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
    }
}
