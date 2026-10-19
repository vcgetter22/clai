import AppKit
import ClaiKit
import SwiftUI

/// The month so far: the number, its basis, the comparison with last month and where the month
/// is heading, on the ledger-green card.
struct HeroCard: View {
    let snapshot: Snapshot

    private var month: Snapshot.Month { snapshot.month }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(snapshot.monthName) so far")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
                Text(Format.usd(month.usd))
                    .font(.system(size: 36, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .contentTransition(.numericText(value: month.usd))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                HStack(spacing: 5) {
                    Chip(text: month.basisKind.label, onCard: true)
                        .help(month.basisKind.explanation)
                    if let delta = snapshot.forecast.deltaVsLastMonth, snapshot.lastMonth.usd > 0 {
                        Chip(text: "\(Format.signedPercent(delta)) vs \(snapshot.lastMonthName.prefix(3))", systemImage: delta >= 0 ? "arrow.up.right" : "arrow.down.right", onCard: true)
                            .help("Projected month against \(snapshot.lastMonthName)'s \(Format.usd(snapshot.lastMonth.usd))")
                    }
                }
                forecastLine
                    .padding(.top, 4)
            }
            Spacer(minLength: 0)
            if let budget = snapshot.budgets.first {
                BudgetRing(budget: budget)
                    .padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.heroFill, in: RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 0.5)
        )
        .help("Usage by the AI tools on this Mac, priced at list prices. Cloud sessions and claude.ai chats leave no logs here and are not included.")
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(snapshot.monthName) so far on this Mac: \(Format.usd(month.usd)), \(month.basisKind.label). On pace for \(Format.usd(snapshot.forecast.projectedUsd)).")
    }

    private var forecastLine: some View {
        VStack(alignment: .leading, spacing: 5) {
            GeometryReader { geometry in
                Capsule()
                    .fill(.white.opacity(0.22))
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(.white)
                            .frame(width: max(6, geometry.size.width * month.elapsedFraction))
                    }
            }
            .frame(width: 168, height: 4)
            .animation(.easeOut(duration: 0.3), value: month.elapsedFraction)
            Text(forecastText)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.white.opacity(0.88))
                .monospacedDigit()
        }
        .help("Day \(month.daysElapsed) of \(month.daysInMonth). Forecast: \(snapshot.forecast.method), \(snapshot.forecast.confidence) confidence.")
    }

    private var forecastText: String {
        guard snapshot.forecast.hasEnoughData else { return "Day \(month.daysElapsed) of \(month.daysInMonth)" }
        return "On pace for \(Format.usd(snapshot.forecast.projectedUsd)) by \(snapshot.monthName.prefix(3)) \(month.daysInMonth)"
    }
}

/// How much of the monthly budget is used, with a tick where the month is heading.
struct BudgetRing: View {
    let budget: Snapshot.Budget

    private var caption: String {
        switch budget.status {
        case .fine: return "of budget"
        case .onPaceToExceed: return "heading for \(Format.percent(budget.projectedPct))"
        case .over: return "over budget"
        }
    }

    private var color: Color {
        switch budget.status {
        case .fine: return .white
        case .onPaceToExceed, .over: return Theme.amberOnGreen
        }
    }

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle().stroke(.white.opacity(0.2), lineWidth: 6)
                Circle()
                    .trim(from: 0, to: min(1, budget.usedPct))
                    .stroke(color, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Circle()
                    .trim(from: max(0, min(1, budget.projectedPct) - 0.006), to: min(1, budget.projectedPct))
                    .stroke(.white.opacity(0.85), style: StrokeStyle(lineWidth: 10, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
                    .opacity(budget.projectedPct > budget.usedPct ? 1 : 0)
                Text(Format.percent(budget.usedPct))
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
            }
            .frame(width: 58, height: 58)
            .animation(.easeOut(duration: 0.3), value: budget.usedPct)
            Text(caption)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(width: 78)
        }
        .help("\(budget.name): \(Format.usd(budget.mtdUsd)) of \(Format.usd(budget.amountUsd)) this month, heading for \(Format.usd(budget.projectedUsd)) (\(Format.percent(budget.projectedPct))).")
    }
}
