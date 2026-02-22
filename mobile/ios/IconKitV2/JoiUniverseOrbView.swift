import SwiftUI

/// Dense Siri-style universe orb with layered wave ribbons, nebula fog, and particles.
/// Drop this into your iOS target and use `JoiUniverseOrbView`.
public struct JoiUniverseOrbView: View {
    public struct Theme {
        public let halo: Color
        public let ringA: Color
        public let ringB: Color
        public let core: Color

        public init(halo: Color, ringA: Color, ringB: Color, core: Color) {
            self.halo = halo
            self.ringA = ringA
            self.ringB = ringB
            self.core = core
        }

        public static let orange = Theme(
            halo: Color(red: 1.00, green: 0.36, blue: 0.04),
            ringA: Color(red: 1.00, green: 0.55, blue: 0.17),
            ringB: Color(red: 1.00, green: 0.83, blue: 0.55),
            core: Color(red: 1.00, green: 0.92, blue: 0.78)
        )

        public static let siriBlue = Theme(
            halo: Color(red: 0.08, green: 0.49, blue: 1.00),
            ringA: Color(red: 0.16, green: 0.69, blue: 1.00),
            ringB: Color(red: 0.59, green: 0.94, blue: 1.00),
            core: Color(red: 0.87, green: 0.98, blue: 1.00)
        )
    }

    public var intensity: CGFloat
    public var speed: CGFloat
    public var theme: Theme

    public init(intensity: CGFloat = 0.35, speed: CGFloat = 1.0, theme: Theme = .orange) {
        self.intensity = intensity
        self.speed = speed
        self.theme = theme
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let scaledTime = t * Double(max(0.2, speed))
            let pulse = 1.0 + sin(scaledTime * 3.0) * (Double(intensity) * 0.11)

            GeometryReader { geo in
                let side = min(geo.size.width, geo.size.height)
                let ringWidth = side * 0.030

                ZStack {
                    // Outer atmosphere glow.
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    theme.halo.opacity(0.88),
                                    theme.halo.opacity(0.25),
                                    .clear,
                                ],
                                center: .center,
                                startRadius: side * 0.03,
                                endRadius: side * 0.54
                            )
                        )

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    theme.halo.opacity(0.46),
                                    .clear,
                                ],
                                center: .center,
                                startRadius: side * 0.20,
                                endRadius: side * 0.62
                            )
                        )
                        .blendMode(.screen)

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color.black.opacity(0.02),
                                    Color.black.opacity(0.32),
                                    Color.black.opacity(0.88),
                                ],
                                center: .center,
                                startRadius: side * 0.02,
                                endRadius: side * 0.44
                            )
                        )

                    UniverseNebula(time: scaledTime, intensity: intensity, theme: theme)
                        .clipShape(Circle())
                        .blendMode(.screen)

                    UniverseParticles(time: scaledTime, intensity: intensity, theme: theme)
                        .clipShape(Circle())
                        .blendMode(.screen)

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    theme.core.opacity(0.98),
                                    theme.ringB.opacity(0.74),
                                    theme.ringA.opacity(0.46),
                                    .clear,
                                ],
                                center: .center,
                                startRadius: side * 0.01,
                                endRadius: side * 0.20
                            )
                        )
                        .blendMode(.screen)

                    Circle()
                        .stroke(theme.ringB.opacity(0.60), lineWidth: ringWidth)
                        .blur(radius: side * 0.012)
                        .blendMode(.screen)
                }
                .padding(side * 0.06)
                .scaleEffect(pulse)
                .drawingGroup()
            }
        }
    }
}

private struct UniverseNebula: View {
    let time: Double
    let intensity: CGFloat
    let theme: JoiUniverseOrbView.Theme

    var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let radius = side * 0.43
            let center = CGPoint(x: size.width * 0.5, y: size.height * 0.5)

            context.drawLayer { layer in
                layer.blendMode = .screen
                layer.addFilter(.blur(radius: side * 0.031))

                let count = Int(164 + intensity * 70)
                for i in 0..<count {
                    let f = Double(i)
                    let seed = f * 0.61803398875
                    let angle = seed * 8.7 + time * (0.09 + seed.truncatingRemainder(dividingBy: 0.08))
                    let radialSeed = abs(sin(seed * 13.7))
                    let radial = CGFloat(pow(radialSeed, 0.62)) * radius
                    let x = center.x + cos(angle) * radial
                    let y = center.y + sin(angle) * radial
                    let pulse = 0.74 + sin(time * (0.55 + seed) + seed * 14.0) * 0.26
                    let cloudR = side * (0.08 + CGFloat(abs(sin(seed * 5.4))) * 0.22) * pulse

                    let color: Color
                    switch i % 5 {
                    case 0:
                        color = theme.halo.opacity(0.30)
                    case 1, 2:
                        color = theme.ringA.opacity(0.24)
                    case 3:
                        color = theme.ringB.opacity(0.26)
                    default:
                        color = theme.core.opacity(0.18)
                    }

                    layer.fill(
                        Path(ellipseIn: CGRect(x: x - cloudR, y: y - cloudR, width: cloudR * 2, height: cloudR * 2)),
                        with: .color(color)
                    )
                }
            }

            // No ribbon traces: cloud/plasma motion only.
        }
    }
}

private struct UniverseParticles: View {
    let time: Double
    let intensity: CGFloat
    let theme: JoiUniverseOrbView.Theme

    var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let radius = side * 0.41
            let center = CGPoint(x: size.width * 0.5, y: size.height * 0.5)
            let count = Int(120 + intensity * 110)

            for i in 0..<count {
                let f = Double(i)
                let seed = f * 0.61803398875
                let angle = seed * 11.0 + time * (0.2 + seed.truncatingRemainder(dividingBy: 0.7))
                let radialSeed = abs(sin(seed * 17.0))
                let radial = CGFloat(pow(radialSeed, 0.55)) * radius
                let x = center.x + cos(angle) * radial
                let y = center.y + sin(angle) * radial
                let twinkle = 0.3 + (sin(time * (1.1 + seed) + seed * 20) + 1.0) * 0.35
                let particleSize = max(0.5, CGFloat(0.6 + twinkle) * side * 0.0058)

                let rect = CGRect(
                    x: x - particleSize * 0.5,
                    y: y - particleSize * 0.5,
                    width: particleSize,
                    height: particleSize
                )

                let isWarm = i % 3 != 0
                let color = isWarm ? theme.ringB.opacity(twinkle * 0.84) : Color.white.opacity(twinkle * 0.65)
                context.fill(Path(ellipseIn: rect), with: .color(color))
            }
        }
    }
}
