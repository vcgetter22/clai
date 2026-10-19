import AppKit
import ClaiKit
import SwiftUI

/// The month so far: the number, its basis, the comparison with last month and where the month
/// is heading, on a green bubble that floats a few smaller bubbles.
struct HeroBubble: View {
    let snapshot: Snapshot
    @State private var shown = false
    @State private var pointer: CGSize = .zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var month: Snapshot.Month { snapshot.month }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(snapshot.monthName) so far")
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.82))
                Text(Format.usd(shown ? month.usd : 0))
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .contentTransition(.numericText(value: shown ? month.usd : 0))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
                HStack(spacing: 5) {
                    Chip(text: month.basisKind.label, onBubble: true)
                        .help(month.basisKind.explanation)
                    if let delta = snapshot.forecast.deltaVsLastMonth, snapshot.lastMonth.usd > 0 {
                        Chip(text: "\(Format.signedPercent(delta)) vs \(snapshot.lastMonthName.prefix(3))", systemImage: delta >= 0 ? "arrow.up.right" : "arrow.down.right", onBubble: true)
                            .help("Projected month against \(snapshot.lastMonthName)'s \(Format.usd(snapshot.lastMonth.usd))")
                    }
                }
                forecastLine
                    .padding(.top, 4)
            }
            Spacer(minLength: 0)
            if let budget = snapshot.budgets.first {
                BudgetRing(budget: budget, shown: shown)
                    .padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous)
                .strokeBorder(LinearGradient(colors: [.white.opacity(0.5), .white.opacity(0.06)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
        )
        .shadow(color: Theme.green.opacity(0.32), radius: 14, y: 7)
        .onContinuousHover { phase in
            guard !reduceMotion else { return }
            switch phase {
            case .active(let location):
                withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
                    pointer = CGSize(width: (location.x - 170) / 18, height: (location.y - 70) / 14)
                }
            case .ended:
                withAnimation(.spring(response: 0.8, dampingFraction: 0.6)) { pointer = .zero }
            }
        }
        .onAppear {
            if reduceMotion {
                shown = true
            } else {
                withAnimation(.spring(response: 0.9, dampingFraction: 0.85).delay(0.05)) { shown = true }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(snapshot.monthName) so far: \(Format.usd(month.usd)), \(month.basisKind.label). On pace for \(Format.usd(snapshot.forecast.projectedUsd)).")
    }

    private var background: some View {
        ZStack {
            HeroGradient()
            BubbleField(bloom: shown, pointer: pointer)
        }
    }

    private var forecastLine: some View {
        VStack(alignment: .leading, spacing: 5) {
            GeometryReader { geometry in
                Capsule()
                    .fill(.white.opacity(0.22))
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(LinearGradient(colors: [.white, Theme.foam], startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(6, geometry.size.width * (shown ? month.elapsedFraction : 0)))
                    }
            }
            .frame(width: 168, height: 5)
            Text(forecastText)
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
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

/// Ledger green to mint; a mesh on macOS 15 and later, a linear gradient before.
struct HeroGradient: View {
    var body: some View {
        if #available(macOS 15.0, *) {
            MeshGradient(
                width: 3,
                height: 3,
                points: [
                    SIMD2<Float>(0, 0), SIMD2<Float>(0.5, 0), SIMD2<Float>(1, 0),
                    SIMD2<Float>(0, 0.5), SIMD2<Float>(0.62, 0.42), SIMD2<Float>(1, 0.55),
                    SIMD2<Float>(0, 1), SIMD2<Float>(0.45, 1), SIMD2<Float>(1, 1),
                ],
                colors: [
                    Theme.green, Theme.teal, Theme.mint,
                    Theme.deep, Theme.green, Theme.teal,
                    Theme.deep, Theme.deep, Theme.green,
                ]
            )
        } else {
            Theme.heroGradient
        }
    }
}

/// Soap bubbles: glossy, translucent, a little parallax under the pointer. They bloom once when
/// the panel opens and then sit still (reduced motion: no bloom, no parallax).
struct BubbleField: View {
    var bloom: Bool
    var pointer: CGSize

    private struct Bubble {
        let x: CGFloat
        let y: CGFloat
        let radius: CGFloat
        let strength: Double
        let depth: CGFloat
    }

    private let bubbles: [Bubble] = [
        Bubble(x: 0.88, y: 0.12, radius: 52, strength: 0.20, depth: 1.0),
        Bubble(x: 0.70, y: 0.92, radius: 30, strength: 0.17, depth: 0.6),
        Bubble(x: 1.00, y: 0.70, radius: 24, strength: 0.24, depth: 1.5),
        Bubble(x: 0.56, y: 0.16, radius: 11, strength: 0.32, depth: 0.8),
        Bubble(x: 0.43, y: 0.86, radius: 15, strength: 0.14, depth: 0.45),
        Bubble(x: 0.76, y: 0.46, radius: 7, strength: 0.38, depth: 1.8),
    ]

    var body: some View {
        GeometryReader { geometry in
            ForEach(0..<bubbles.count, id: \.self) { index in
                let bubble = bubbles[index]
                Circle()
                    .fill(RadialGradient(colors: [.white.opacity(bubble.strength * 1.7), .white.opacity(bubble.strength * 0.25)], center: UnitPoint(x: 0.34, y: 0.3), startRadius: 0, endRadius: bubble.radius))
                    .overlay(Circle().strokeBorder(.white.opacity(bubble.strength * 1.4), lineWidth: 0.8))
                    .frame(width: bubble.radius * 2, height: bubble.radius * 2)
                    .scaleEffect(bloom ? 1 : 0.35)
                    .opacity(bloom ? 1 : 0)
                    .position(
                        x: geometry.size.width * bubble.x + pointer.width * bubble.depth,
                        y: geometry.size.height * bubble.y + pointer.height * bubble.depth
                    )
                    .animation(.spring(response: 0.75, dampingFraction: 0.58).delay(Double(index) * 0.06), value: bloom)
            }
        }
        .allowsHitTesting(false)
    }
}

/// How much of the monthly budget is used, with a tick where the month is heading.
struct BudgetRing: View {
    let budget: Snapshot.Budget
    let shown: Bool

    private var color: Color {
        switch budget.status {
        case .fine: return .white
        case .onPaceToExceed, .over: return Theme.amberOnGreen
        }
    }

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle().stroke(.white.opacity(0.2), lineWidth: 7)
                Circle()
                    .trim(from: 0, to: shown ? min(1, budget.usedPct) : 0)
                    .stroke(color, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Circle()
                    .trim(from: max(0, min(1, budget.projectedPct) - 0.006), to: min(1, budget.projectedPct))
                    .stroke(.white.opacity(0.85), style: StrokeStyle(lineWidth: 11, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
                    .opacity(shown && budget.projectedPct > budget.usedPct ? 1 : 0)
                Text(Format.percent(budget.usedPct))
                    .font(.system(size: 13.5, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
            }
            .frame(width: 60, height: 60)
            Text(budget.status == .fine ? "of budget" : "over pace")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.85))
        }
        .help("\(budget.name): \(Format.usd(budget.mtdUsd)) of \(Format.usd(budget.amountUsd)) this month, heading for \(Format.usd(budget.projectedUsd)) (\(Format.percent(budget.projectedPct))).")
    }
}
