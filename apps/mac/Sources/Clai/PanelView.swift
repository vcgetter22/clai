import AppKit
import ClaiCore
import SwiftUI

enum PanelContext: Equatable {
    case popover
    case window(welcome: Bool)
}

/// The panel: in the popover under the menu bar item and in clai's window.
struct PanelView: View {
    @ObservedObject var state: AppState
    let context: PanelContext

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if case .window(let welcome) = context, welcome {
                WelcomeNote()
                    .padding(.horizontal, 16)
                    .padding(.top, 34)
            }
            if AppVersion.needsMoving && !state.isSample {
                MoveNote()
                    .padding(.horizontal, 16)
                    .padding(.top, context == .popover ? 16 : 34)
            }
            switch state.page {
            case .overview:
                Overview(state: state, inWindow: context != .popover)
            case .settings:
                SettingsPage(state: state, inWindow: context != .popover)
            }
        }
        .frame(width: Theme.panelWidth)
    }
}

// MARK: - Overview

struct Overview: View {
    @ObservedObject var state: AppState
    let inWindow: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Header(state: state)
            if !state.summary.isEmpty {
                MonthCard(summary: state.summary)
                DailyChart(days: state.summary.days)
                Breakdown(summary: state.summary)
                PlanValue(state: state)
                if let limits = state.codexLimits, limits.isCurrent || state.isSample {
                    LimitsRow(limits: limits)
                }
            } else if state.hasScanned {
                EmptyState(sources: state.sources)
            } else {
                Reading()
            }
            Footer(state: state)
        }
        .padding(16)
        .padding(.top, inWindow ? 18 : 0)
    }
}

struct Header: View {
    @ObservedObject var state: AppState

    var body: some View {
        HStack(spacing: 8) {
            Image(nsImage: MenuBarIcon.tally)
                .renderingMode(.template)
                .foregroundStyle(Theme.accent)
            Text("clai")
                .font(.system(size: 15, weight: .semibold))
            Spacer()
            if state.scanning && !state.isSample {
                ProgressView()
                    .controlSize(.small)
                    .help("Reading your logs")
            } else {
                IconButton(symbol: "arrow.clockwise", help: "Refresh") { state.refresh() }
            }
            IconButton(symbol: "gearshape", help: "Settings") { state.page = .settings }
        }
    }
}

struct IconButton: View {
    let symbol: String
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12.5, weight: .medium))
                .frame(width: 26, height: 22)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? Theme.platter : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .help(help)
        .accessibilityLabel(help)
        .onHover { hovering = $0 }
    }
}

// MARK: The month

struct MonthCard: View {
    let summary: Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(Format.monthName(summary.today)) so far")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
            Text(Format.usd(summary.monthCost))
                .font(.system(size: 34, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(basisLine)
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.78))
                .help("What these requests would cost at the vendors' API list prices. With a subscription you pay the plan, not this.")
            HStack(alignment: .firstTextBaseline) {
                CardFigure(label: "Today", value: summary.todayCost)
                Spacer()
                CardFigure(label: "Last month", value: summary.lastMonthCost, alignment: .trailing)
            }
            .padding(.top, 8)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(LinearGradient(colors: [Theme.cardTop, Theme.cardBottom], startPoint: .top, endPoint: .bottom))
        )
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.12)))
        .accessibilityElement(children: .combine)
    }

    private var basisLine: String {
        var line = "API-equivalent at list prices"
        if let projected = summary.projectedMonthCost, projected > summary.monthCost * 1.02 {
            line += " · on pace for \(Format.usd(projected, compact: projected >= 10_000))"
        }
        return line
    }
}

struct CardFigure: View {
    let label: String
    let value: Double
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(label)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(.white.opacity(0.75))
            Text(Format.usd(value))
                .font(.system(size: 15, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
        }
    }
}

// MARK: The last 30 days

struct DailyChart: View {
    let days: [Summary.DayTotal]
    @State private var hovered: Day?

    var body: some View {
        let highest = max(days.map(\.cost).max() ?? 0, 0.01)
        let pointed = days.first { $0.day == hovered }
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(pointed.map { Format.shortDay($0.day) } ?? "Last 30 days")
                Spacer()
                Text(pointed.map { Format.usd($0.cost) } ?? "Highest \(Format.usd(highest))")
                    .monospacedDigit()
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary)
            GeometryReader { geometry in
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(days) { day in
                        let share = day.cost / highest
                        VStack(spacing: 0) {
                            Spacer(minLength: 0)
                            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                                .fill(day.cost > 0 ? Theme.accent.opacity(hovered == nil || hovered == day.day ? 1 : 0.45) : Theme.hairline)
                                .frame(height: day.cost > 0 ? max(2, geometry.size.height * share) : 1)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                        .onHover { inside in
                            if inside { hovered = day.day } else if hovered == day.day { hovered = nil }
                        }
                    }
                }
            }
            .frame(height: 56)
            HStack {
                Text(days.first.map { Format.shortDay($0.day) } ?? "")
                Spacer()
                Text("Today")
            }
            .font(.system(size: 10))
            .foregroundStyle(.tertiary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Spend over the last 30 days, highest day \(Format.usd(highest))")
    }
}

// MARK: Where it went

struct Breakdown: View {
    let summary: Summary
    @State private var showModels = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Segmented(options: [(false, "Tools"), (true, "Models")], selection: $showModels)
            if showModels {
                ForEach(summary.models.prefix(6)) { model in
                    Row(dot: model.tools.first.map(Theme.color) ?? .secondary,
                        name: model.name,
                        note: note(for: model.basis),
                        detail: Format.tokens(model.tokens) + " tokens",
                        cost: model.basis == .unpriced ? "–" : Format.usd(model.cost))
                }
                if summary.models.count > 6 {
                    Text("and \(summary.models.count - 6) more")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(summary.tools) { tool in
                    VStack(spacing: 4) {
                        Row(dot: Theme.color(tool.tool), name: tool.tool.name, note: nil,
                            detail: Format.tokens(tool.tokens) + " tokens", cost: Format.usd(tool.cost))
                        ShareBar(share: summary.monthCost > 0 ? tool.cost / summary.monthCost : 0, color: Theme.color(tool.tool))
                    }
                }
            }
        }
    }

    private func note(for basis: PriceBasis) -> String? {
        switch basis {
        case .listed: return nil
        case .estimated(let like): return "priced like \(like)"
        case .logged: return "cost as logged"
        case .unpriced: return "no price yet"
        }
    }
}

struct Row: View {
    let dot: Color
    let name: String
    let note: String?
    let detail: String
    let cost: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(dot).frame(width: 7, height: 7).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.system(size: 12.5, weight: .medium))
                    .lineLimit(1)
                if let note {
                    Text(note)
                        .font(.system(size: 10.5))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            Text(detail)
                .font(.system(size: 11))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(cost)
                .font(.system(size: 12.5, weight: .semibold))
                .monospacedDigit()
                .frame(minWidth: 66, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

struct ShareBar: View {
    let share: Double
    let color: Color

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.platter)
                Capsule().fill(color.opacity(0.85)).frame(width: max(3, geometry.size.width * min(1, max(0, share))))
            }
        }
        .frame(height: 3)
        .padding(.leading, 15)
    }
}

/// A segmented control drawn in SwiftUI (so screenshots can render it too).
struct Segmented<Value: Hashable>: View {
    let options: [(Value, String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.0) { option in
                let value = option.0
                Button {
                    selection = value
                } label: {
                    Text(option.1)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(selection == value ? .primary : .secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(selection == value ? Color(light: 0xFFFFFF, dark: 0x636366) : .clear)
                                .shadow(color: .black.opacity(selection == value ? 0.12 : 0), radius: 1, y: 0.5)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == value ? .isSelected : [])
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.platter))
    }
}

// MARK: Plans and limits

struct PlanValue: View {
    @ObservedObject var state: AppState

    var body: some View {
        let rows = Vendor.allCases.compactMap { vendor -> (Plan, Double)? in
            guard let plan = state.plan(for: vendor) else { return nil }
            return (plan, state.summary.vendorMonthCost[vendor] ?? 0)
        }
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(rows, id: \.0.id) { row in
                    let plan = row.0
                    let value = row.1
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(plan.name)
                                .font(.system(size: 12.5, weight: .medium))
                            Text("\(Format.usd(value)) of use for \(Format.usd(plan.monthly)) a month")
                                .font(.system(size: 10.5))
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        Spacer()
                        Text(Format.multiple(value / plan.monthly))
                            .font(.system(size: 15, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(value >= plan.monthly ? Theme.accent : .primary)
                            .help("This month's usage at API list prices, as a multiple of what the plan costs.")
                    }
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.platter))
        }
    }
}

struct LimitsRow: View {
    let limits: RateLimits

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Codex plan limits")
                    .font(.system(size: 12.5, weight: .medium))
                Spacer()
                if limits.observedAt > 0 {
                    Text("as of \(Format.relative(Date(timeIntervalSince1970: limits.observedAt)))")
                        .font(.system(size: 10.5))
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 12) {
                if let primary = limits.primary { Meter(label: windowName(primary, fallback: "5 hours"), window: primary) }
                if let secondary = limits.secondary { Meter(label: windowName(secondary, fallback: "Week"), window: secondary) }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.platter))
    }

    private func windowName(_ window: RateLimits.Window, fallback: String) -> String {
        guard let minutes = window.windowMinutes else { return fallback }
        if minutes == 10_080 { return "Week" }
        if minutes % 1440 == 0 { return "\(minutes / 1440) days" }
        if minutes % 60 == 0 { return "\(minutes / 60) hours" }
        return "\(minutes) min"
    }
}

struct Meter: View {
    let label: String
    let window: RateLimits.Window

    var body: some View {
        let used = min(100, max(0, window.usedPercent))
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label)
                Spacer()
                Text("\(Int(used.rounded()))%").monospacedDigit()
            }
            .font(.system(size: 11, weight: .medium))
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.hairline)
                    Capsule()
                        .fill(used >= 90 ? Theme.critical : used >= 70 ? Theme.warning : Theme.accent)
                        .frame(width: max(3, geometry.size.width * used / 100))
                }
            }
            .frame(height: 4)
            if let resets = window.resetsAt {
                Text("resets \(Format.resetTime(Date(timeIntervalSince1970: resets)))")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

extension RateLimits {
    /// Limits logged in the last week whose windows have not all reset since.
    var isCurrent: Bool {
        let now = Date().timeIntervalSince1970
        guard now - observedAt < 7 * 86_400 else { return false }
        let windows = [primary, secondary].compactMap { $0 }
        return windows.contains { ($0.resetsAt ?? now + 1) > now }
    }
}

// MARK: States

struct Reading: View {
    var body: some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            Text("Reading the logs your AI tools keep on this Mac…")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
    }
}

struct EmptyState: View {
    let sources: [SourceStatus]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No AI usage on this Mac yet")
                .font(.system(size: 14, weight: .semibold))
            Text("clai counts what Claude Code, Codex, Gemini CLI, Qwen Code and OpenCode record in their logs on this Mac. Use one of them and your usage shows up here within a minute.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("Chats on claude.ai, chatgpt.com or gemini.google.com, and agents that run in the cloud, keep no logs on your Mac.")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.platter))
    }
}

struct Footer: View {
    @ObservedObject var state: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let update = state.update {
                HStack {
                    Text("clai \(update.version.description) is available")
                        .font(.system(size: 11.5, weight: .medium))
                    Spacer()
                    Button("Download") { NSWorkspace.shared.open(URL(string: "https://getclai.vercel.app")!) }
                        .buttonStyle(.link)
                        .font(.system(size: 11.5, weight: .medium))
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.accent.opacity(0.12)))
            }
            TimelineView(.periodic(from: .now, by: 30)) { context in
                HStack {
                    Text(updatedText(now: context.date))
                    Spacer()
                    Text("Usage data stays on this Mac")
                }
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
            }
        }
    }

    private func updatedText(now: Date) -> String {
        guard let last = state.lastScan else { return state.hasScanned ? "" : "Reading…" }
        return "Updated \(Format.relative(last, now: now))"
    }
}

struct WelcomeNote: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(nsImage: MenuBarIcon.tally)
                .renderingMode(.template)
                .foregroundStyle(Theme.accent)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text("clai lives in your menu bar")
                    .font(.system(size: 13, weight: .semibold))
                Text("Click the tally at the top of the screen to see this panel. If it is hidden (behind the camera notch, or not allowed in System Settings → Menu Bar), open clai again and this window comes back. Quit with ⌘Q or a right click on the tally.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.platter))
    }
}

struct MoveNote: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Move clai to your Applications folder")
                .font(.system(size: 12.5, weight: .semibold))
            Text("It is running from a download or a disk image. Drag clai into Applications and open it from there, so it can start at login and keep its place.")
                .font(.system(size: 11.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.warning.opacity(0.14)))
    }
}
