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
    static let background = Color(hex: 0x120A08)
    static let surface = Color(hex: 0x1B100B)
    static let surfaceVariant = Color(hex: 0x261611)
    static let surfaceHigh = Color(hex: 0x321C14)

    // Accent — Volcanic Arc (flame orange)
    static let primary = Color(hex: 0xFF5A1F)
    static let primaryMuted = Color(hex: 0xB93A13)
    static let primaryGlow = Color(hex: 0xFF5A1F, opacity: 0.24)

    // Accent — Ember amber
    static let secondary = Color(hex: 0xFF9F2E)
    static let secondaryMuted = Color(hex: 0xD97512)
    static let secondaryGlow = Color(hex: 0xFF9F2E, opacity: 0.24)

    // Accent — Hot magenta
    static let tertiary = Color(hex: 0xFF2D78)
    static let tertiaryMuted = Color(hex: 0xB51F5B)

    // Semantic
    static let error = Color(hex: 0xFF5B5B)
    static let success = Color(hex: 0x70D68B)
    static let warning = Color(hex: 0xFFC04A)
    static let info = Color(hex: 0xFF8A3A)

    // Text
    static let textPrimary = Color(hex: 0xFFF1EA)
    static let textSecondary = Color(hex: 0xE0B8A4)
    static let textTertiary = Color(hex: 0x9E6A52)
    static let textOnPrimary = Color(hex: 0x1B100B)

    // Borders & dividers
    static let border = Color(hex: 0x4A2718)
    static let borderSubtle = Color(hex: 0x372013)
    static let divider = Color(hex: 0x261611)
}
