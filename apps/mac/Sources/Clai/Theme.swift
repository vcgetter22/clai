import AppKit
import ClaiCore
import SwiftUI

/// clai's colours: ledger green is the one accent; provider colours tell the tools apart.
enum Theme {
    static let accent = Color(light: 0x1E7A62, dark: 0x4FBE9C)
    static let cardTop = Color(hex: 0x1E7A62)
    static let cardBottom = Color(hex: 0x0E5444)
    static let warning = Color(light: 0x9A6D00, dark: 0xD9A441)
    static let critical = Color(light: 0xA83A3A, dark: 0xE06C6C)
    static let hairline = Color.primary.opacity(0.08)
    static let platter = Color.primary.opacity(0.045)

    static func color(_ tool: Tool) -> Color {
        switch tool {
        case .claudeCode: return Color(light: 0xC96442, dark: 0xE08A68)
        case .cowork: return Color(light: 0x9C5A3C, dark: 0xC98E70)
        case .codex: return Color(light: 0x3B6FE0, dark: 0x6F98F2)
        case .gemini: return Color(light: 0x8B5CC7, dark: 0xB08BE6)
        case .qwen: return Color(light: 0x2A9D8F, dark: 0x5CC2B5)
        case .opencode: return Color(light: 0x5F6B78, dark: 0x9AA6B2)
        }
    }

    static let panelWidth: CGFloat = 360
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }

    /// A colour that follows the light or dark appearance.
    init(light: UInt32, dark: UInt32) {
        self.init(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let hex = isDark ? dark : light
            return NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                           green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255,
                           alpha: 1)
        })
    }
}
