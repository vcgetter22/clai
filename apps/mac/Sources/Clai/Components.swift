import AppKit
import ClaiKit
import SwiftUI

// MARK: - Buttons

/// Round icon button for the header and notices: a quiet fill that deepens under the pointer.
struct IconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        IconButtonBody(configuration: configuration)
    }
}

private struct IconButtonBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false

    var body: some View {
        configuration.label
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(hovering ? Color.primary : Color.secondary)
            .frame(width: 28, height: 28)
            .background(Circle().fill(Color.primary.opacity(configuration.isPressed ? 0.15 : hovering ? 0.09 : 0.05)))
            .contentShape(Circle())
            .animation(.easeOut(duration: 0.12), value: hovering)
            .onHover { hovering = $0 }
    }
}

/// The one prominent action in a view: a flat ledger-green capsule.
struct ProminentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        ProminentButtonBody(configuration: configuration)
    }
}

private struct ProminentButtonBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(height: 28)
            .background(Capsule().fill(configuration.isPressed ? Theme.buttonPressed : hovering ? Theme.buttonHover : Theme.buttonFill))
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Capsule())
            .animation(.easeOut(duration: 0.12), value: hovering)
            .onHover { hovering = $0 }
    }
}

/// Quiet capsule button for secondary actions.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        SecondaryButtonBody(configuration: configuration)
    }
}

private struct SecondaryButtonBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false

    var body: some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(Capsule().fill(Color.primary.opacity(configuration.isPressed ? 0.14 : hovering ? 0.09 : 0.06)))
            .contentShape(Capsule())
            .animation(.easeOut(duration: 0.12), value: hovering)
            .onHover { hovering = $0 }
    }
}

// MARK: - Tabs

/// A segmented control drawn by hand (so it renders the same offscreen): the selected tab sits
/// on a raised capsule, as in the system control.
struct SegmentedTabs<Tab: Hashable & Identifiable>: View {
    let tabs: [Tab]
    @Binding var selection: Tab
    let title: (Tab) -> String
    @Namespace private var namespace
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(tabs) { tab in
                let selected = tab == selection
                Button {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { selection = tab }
                } label: {
                    Text(title(tab))
                        .font(.system(size: 12, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? Color.primary : Color.secondary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                        .frame(height: 24)
                        .background {
                            if selected {
                                Capsule()
                                    .fill(scheme == .dark ? Color.white.opacity(0.16) : Color.white)
                                    .shadow(color: .black.opacity(scheme == .dark ? 0.25 : 0.12), radius: 1, y: 0.5)
                                    .matchedGeometryEffect(id: "selection", in: namespace)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Capsule().fill(Color.primary.opacity(0.06)))
    }
}

// MARK: - Small pieces

/// A tag that says what a figure is (basis, comparison, plan).
struct Chip: View {
    let text: String
    var systemImage: String?
    var onCard = false

    var body: some View {
        HStack(spacing: 3) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 8.5, weight: .bold)) }
            Text(text)
        }
        .font(.system(size: 10.5, weight: .medium))
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .foregroundStyle(onCard ? Color.white : Color.secondary)
        .background(Capsule().fill(onCard ? Color.white.opacity(0.16) : Color.primary.opacity(0.07)))
    }
}

/// A dot in a provider's colour.
struct ProviderDot: View {
    let color: Color
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
    }
}

/// A share of the whole as a thin bar.
struct ShareBar: View {
    let share: Double
    let color: Color

    var body: some View {
        GeometryReader { geometry in
            Capsule()
                .fill(color.opacity(0.14))
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(color)
                        .frame(width: max(4, geometry.size.width * min(1, max(0, share))))
                }
        }
        .frame(height: 4)
        .animation(.easeOut(duration: 0.3), value: share)
    }
}

struct SectionTitle: View {
    let text: String
    var trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(.secondary)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(.system(size: 11, weight: .regular))
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

/// The app's logo in the panel header: the tally on a ledger-green squircle, like the icon.
struct LogoMark: View {
    var size: CGFloat = 22

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.27, style: .continuous).fill(Theme.heroFill)
            Image(nsImage: MenuBarIcon.tally)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .foregroundStyle(.white)
                .frame(width: size * 0.62)
        }
        .frame(width: size, height: size)
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
