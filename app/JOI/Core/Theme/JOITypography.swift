import SwiftUI

enum JOITypography {
    static let fontFamily = "Inter"
    static let fontFamilyMono = "JetBrains Mono"

    static let headlineLarge = Font.system(size: 28, weight: .semibold)
    static let headlineMedium = Font.system(size: 22, weight: .semibold)
    static let headlineSmall = Font.system(size: 18, weight: .semibold)

    static let bodyLarge = Font.system(size: 16, weight: .regular)
    static let bodyMedium = Font.system(size: 14, weight: .regular)
    static let bodySmall = Font.system(size: 12, weight: .regular)

    static let labelLarge = Font.system(size: 14, weight: .semibold)
    static let labelMedium = Font.system(size: 12, weight: .medium)
    static let labelSmall = Font.system(size: 10, weight: .medium)

    static let monoMedium = Font.system(size: 14, weight: .regular, design: .monospaced)
    static let monoSmall = Font.system(size: 12, weight: .regular, design: .monospaced)
}
