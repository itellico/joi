import SwiftUI

extension Color {
    init(hex: UInt, opacity: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: opacity)
    }
}

enum JOIColors {
    // Core backgrounds
    static let background = Color(hex: 0x0A0A0F)
    static let surface = Color(hex: 0x12121A)
    static let surfaceVariant = Color(hex: 0x1A1A25)
    static let surfaceHigh = Color(hex: 0x222230)

    // Accent — Cyan
    static let primary = Color(hex: 0x00E5FF)
    static let primaryMuted = Color(hex: 0x0097A7)
    static let primaryGlow = Color(hex: 0x00E5FF, opacity: 0.2)

    // Accent — Amber
    static let secondary = Color(hex: 0xFFAB40)
    static let secondaryMuted = Color(hex: 0xC77800)
    static let secondaryGlow = Color(hex: 0xFFAB40, opacity: 0.2)

    // Accent — Violet
    static let tertiary = Color(hex: 0xB388FF)
    static let tertiaryMuted = Color(hex: 0x7C4DFF)

    // Semantic
    static let error = Color(hex: 0xFF5252)
    static let success = Color(hex: 0x69F0AE)
    static let warning = Color(hex: 0xFFD740)
    static let info = Color(hex: 0x40C4FF)

    // Text
    static let textPrimary = Color(hex: 0xF5F5F7)
    static let textSecondary = Color(hex: 0xB0B0C0)
    static let textTertiary = Color(hex: 0x6B6B80)
    static let textOnPrimary = Color(hex: 0x0A0A0F)

    // Borders & dividers
    static let border = Color(hex: 0x2A2A3A)
    static let borderSubtle = Color(hex: 0x1E1E2E)
    static let divider = Color(hex: 0x1A1A25)
}
