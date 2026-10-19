import AppKit
import ClaiKit
import SwiftUI

/// clai for Mac's look: Apple-native materials and type, quiet surfaces. The ledger green from
/// docs/design-principles.md stays the one accent; provider colours match the dashboard.
enum Theme {
    static let accent = dynamic(light: 0x1E7A62, dark: 0x4FBE9C)
    static let accentSoft = dynamic(light: 0xDDEFE7, dark: 0x173B31)
    static let warning = dynamic(light: 0x9A6D00, dark: 0xD9A441)
    static let critical = dynamic(light: 0xA83A3A, dark: 0xE06C6C)
    static let info = dynamic(light: 0x4A5FA8, dark: 0x8FA3E0)

    /// Ledger green and its deeper shade: the month card, the logo and the prominent button.
    static let green = Color(hex: 0x1E7A62)
    static let deep = Color(hex: 0x0E5444)
    /// Highlight for a budget that is on pace to be exceeded, readable on the green card.
    static let amberOnGreen = Color(hex: 0xFFD27A)

    /// The month card: ledger green settling into the deeper shade, white text above 5:1.
    static var heroFill: LinearGradient {
        LinearGradient(colors: [green, deep], startPoint: .top, endPoint: .bottom)
    }

    /// The prominent button at rest, under the pointer and pressed (white text 5.2:1 and up).
    static let buttonFill = green
    static let buttonHover = Color(hex: 0x1A6B56)
    static let buttonPressed = Color(hex: 0x155C4A)

    static func provider(_ key: String?) -> Color {
        switch key {
        case "anthropic": return dynamic(light: 0x1E7A62, dark: 0x4FBE9C)
        case "openai": return dynamic(light: 0x4A5FA8, dark: 0x8FA3E0)
        case "google": return dynamic(light: 0xB07A1C, dark: 0xD9A441)
        case "cursor": return dynamic(light: 0x7A4E9A, dark: 0xB48CD0)
        case "github": return dynamic(light: 0x5C665F, dark: 0x98A39C)
        case "xai": return dynamic(light: 0x6B4E3A, dark: 0xB89A82)
        case "mistral": return dynamic(light: 0x3F7F8C, dark: 0x7FBFCC)
        case nil: return accent
        default: return dynamic(light: 0x7D8781, dark: 0x8A948E)
        }
    }

    static func severity(_ level: Severity) -> Color {
        switch level {
        case .critical: return critical
        case .warning: return warning
        case .opportunity: return accent
        case .info: return info
        }
    }

    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(hex: dark) : NSColor(hex: light)
        })
    }
}

enum Metrics {
    static let panelWidth: CGFloat = 368
    static let gutter: CGFloat = 12
    static let cardRadius: CGFloat = 18
    static let heroRadius: CGFloat = 18
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}

// MARK: - Export rendering

private struct ExportRenderingKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True while the panel is drawn offscreen for a PNG (CI screenshots): materials and glass do
    /// not render there, so surfaces fall back to plain fills.
    var exportRendering: Bool {
        get { self[ExportRenderingKey.self] }
        set { self[ExportRenderingKey.self] = newValue }
    }
}

// MARK: - Surfaces

/// A rounded card. Liquid Glass on macOS 26, a quiet translucent fill before that.
struct Platter: ViewModifier {
    var cornerRadius: CGFloat = Metrics.cardRadius
    var tint: Color?
    @Environment(\.exportRendering) private var exporting
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if exporting {
            content.background(shape.fill(scheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.78)))
                .overlay(shape.strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5))
        } else {
            content.modifier(GlassSurface(shape: shape, tint: tint))
        }
    }
}

#if compiler(>=6.2)
struct GlassSurface: ViewModifier {
    var shape: RoundedRectangle
    var tint: Color?

    func body(content: Content) -> some View {
        if #available(macOS 26.0, *) {
            if let tint {
                content.glassEffect(.regular.tint(tint), in: shape)
            } else {
                content.glassEffect(.regular, in: shape)
            }
        } else {
            content.modifier(FallbackSurface(shape: shape))
        }
    }
}
#else
struct GlassSurface: ViewModifier {
    var shape: RoundedRectangle
    var tint: Color?

    func body(content: Content) -> some View {
        content.modifier(FallbackSurface(shape: shape))
    }
}
#endif

struct FallbackSurface: ViewModifier {
    var shape: RoundedRectangle
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content
            .background(shape.fill(scheme == .dark ? Color.white.opacity(0.06) : Color.black.opacity(0.035)))
            .overlay(shape.strokeBorder(Color.primary.opacity(scheme == .dark ? 0.08 : 0.06), lineWidth: 0.5))
    }
}

extension View {
    func platter(cornerRadius: CGFloat = Metrics.cardRadius, tint: Color? = nil) -> some View {
        modifier(Platter(cornerRadius: cornerRadius, tint: tint))
    }
}
