import SwiftUI

enum JOITypography {
    static let fontFamily = "Inter"
    static let fontFamilyMono = "JetBrains Mono"

#if os(iOS)
    private static let bodyLargeSize: CGFloat = 17
    private static let bodyMediumSize: CGFloat = 15
    private static let bodySmallSize: CGFloat = 13
    private static let labelLargeSize: CGFloat = 15
    private static let labelMediumSize: CGFloat = 13
    private static let labelSmallSize: CGFloat = 11
#else
    private static let bodyLargeSize: CGFloat = 16
    private static let bodyMediumSize: CGFloat = 14
    private static let bodySmallSize: CGFloat = 12
    private static let labelLargeSize: CGFloat = 14
    private static let labelMediumSize: CGFloat = 12
    private static let labelSmallSize: CGFloat = 10
#endif

    static let headlineLarge = Font.system(size: 28, weight: .semibold)
    static let headlineMedium = Font.system(size: 22, weight: .semibold)
    static let headlineSmall = Font.system(size: 18, weight: .semibold)

    static let bodyLarge = Font.system(size: bodyLargeSize, weight: .regular)
    static let bodyMedium = Font.system(size: bodyMediumSize, weight: .regular)
    static let bodySmall = Font.system(size: bodySmallSize, weight: .regular)

    static let labelLarge = Font.system(size: labelLargeSize, weight: .semibold)
    static let labelMedium = Font.system(size: labelMediumSize, weight: .medium)
    static let labelSmall = Font.system(size: labelSmallSize, weight: .medium)

    static let monoMedium = Font.system(size: bodyMediumSize, weight: .regular, design: .monospaced)
    static let monoSmall = Font.system(size: bodySmallSize, weight: .regular, design: .monospaced)
}
