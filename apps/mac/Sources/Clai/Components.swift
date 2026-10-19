import AppKit
import ClaiKit
import SwiftUI

// MARK: - Buttons

/// Round icon button that swells a little on hover and squishes when pressed.
struct BubbleIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        BubbleIconButtonBody(configuration: configuration)
    }
}

private struct BubbleIconButtonBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        configuration.label
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(hovering ? Color.primary : Color.secondary)
            .frame(width: 28, height: 28)
            .background(Circle().fill(Color.primary.opacity(configuration.isPressed ? 0.16 : hovering ? 0.1 : 0.055)))
            .contentShape(Circle())
            .scaleEffect(reduceMotion ? 1 : configuration.isPressed ? 0.88 : hovering ? 1.07 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.55), value: hovering)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
            .onHover { hovering = $0 }
    }
}

/// The one prominent action: a glossy green capsule.
struct BubbleProminentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        BubbleProminentBody(configuration: configuration)
    }
}

private struct BubbleProminentBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(height: 30)
            .background(
                Capsule()
                    .fill(Theme.buttonGradient)
                    .overlay(Capsule().fill(LinearGradient(colors: [.white.opacity(0.32), .white.opacity(0)], startPoint: .top, endPoint: .center)).padding(1))
                    .overlay(Capsule().strokeBorder(.white.opacity(0.25), lineWidth: 0.5))
            )
            .shadow(color: Theme.green.opacity(hovering ? 0.45 : 0.28), radius: hovering ? 9 : 5, y: hovering ? 4 : 2)
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Capsule())
            .scaleEffect(reduceMotion ? 1 : configuration.isPressed ? 0.94 : hovering ? 1.03 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: hovering)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
            .onHover { hovering = $0 }
    }
}

/// Quiet capsule button for secondary actions.
struct BubbleCapsuleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        BubbleCapsuleBody(configuration: configuration)
    }
}

private struct BubbleCapsuleBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false

    var body: some View {
        configuration.label
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(Capsule().fill(Color.primary.opacity(configuration.isPressed ? 0.14 : hovering ? 0.09 : 0.06)))
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.65), value: configuration.isPressed)
            .onHover { hovering = $0 }
    }
}

// MARK: - Small pieces

/// A tag that says what a figure is (basis, comparison, plan).
struct Chip: View {
    let text: String
    var systemImage: String?
    var onBubble = false

    var body: some View {
        HStack(spacing: 3) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 8.5, weight: .bold)) }
            Text(text)
        }
        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .foregroundStyle(onBubble ? Color.white : Color.secondary)
        .background(Capsule().fill(onBubble ? Color.white.opacity(0.2) : Color.primary.opacity(0.07)))
        .overlay(Capsule().strokeBorder(onBubble ? Color.white.opacity(0.28) : Color.clear, lineWidth: 0.5))
    }
}

/// A glossy dot in a provider's colour.
struct ProviderDot: View {
    let color: Color
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(color.gradient)
            .overlay(Circle().fill(RadialGradient(colors: [.white.opacity(0.55), .white.opacity(0)], center: UnitPoint(x: 0.32, y: 0.28), startRadius: 0, endRadius: size * 0.55)))
            .frame(width: size, height: size)
    }
}

/// A share of the whole as a rounded bar.
struct ShareBar: View {
    let share: Double
    let color: Color
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            Capsule()
                .fill(color.opacity(0.14))
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(color.gradient)
                        .frame(width: max(4, geometry.size.width * min(1, max(0, shown ? share : 0))))
                }
        }
        .frame(height: 4)
        .onAppear {
            if reduceMotion { shown = true } else { withAnimation(.spring(response: 0.7, dampingFraction: 0.8).delay(0.1)) { shown = true } }
        }
    }
}

struct SectionTitle: View {
    let text: String
    var trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text)
                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

/// The tally mark in a green bubble: the app's logo in the panel header.
struct LogoBubble: View {
    var size: CGFloat = 22

    var body: some View {
        ZStack {
            Circle().fill(Theme.heroGradient)
            Circle().fill(RadialGradient(colors: [.white.opacity(0.5), .white.opacity(0)], center: UnitPoint(x: 0.3, y: 0.25), startRadius: 0, endRadius: size * 0.6))
            Image(nsImage: MenuBarIcon.tally)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .foregroundStyle(.white)
                .frame(width: size * 0.62)
        }
        .frame(width: size, height: size)
        .shadow(color: Theme.green.opacity(0.35), radius: 3, y: 1)
    }
}

extension Severity {
    var symbol: String {
        switch self {
        case .critical: return "xmark.octagon.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .opportunity: return "lightbulb.max.fill"
        case .info: return "info.circle.fill"
        }
    }
}
