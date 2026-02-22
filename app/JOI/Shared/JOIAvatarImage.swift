import SwiftUI

/// Reusable JOI identity orb.
/// Transparent mode uses the exported Firestorm circle for top bars/headers.
struct JOIAvatarImage: View {
    enum Style {
        case outline
        case glow
        case transparent
        case firestorm
    }

    var style: Style
    var activityLevel: Double
    var isActive: Bool
    var showPulseRings: Bool
    var animated: Bool

    init(
        style: Style = .outline,
        activityLevel: Double = 0.18,
        isActive: Bool = true,
        showPulseRings: Bool = true,
        animated: Bool = true
    ) {
        self.style = style
        self.activityLevel = activityLevel
        self.isActive = isActive
        self.showPulseRings = showPulseRings
        self.animated = animated
    }

    var body: some View {
        Group {
            switch style {
            case .firestorm:
                JOIFirestormAvatar(
                    intensity: firestormIntensity,
                    speed: firestormSpeed,
                    animated: animated
                )
            case .transparent:
                Group {
                    if animated {
                        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
                            transparentLayer(time: timeline.date.timeIntervalSinceReferenceDate)
                        }
                    } else {
                        transparentLayer(time: Date.now.timeIntervalSinceReferenceDate)
                    }
                }
                .drawingGroup()
            case .outline, .glow:
                Group {
                    if animated {
                        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
                            orbLayer(time: timeline.date.timeIntervalSinceReferenceDate)
                        }
                    } else {
                        orbLayer(time: Date.now.timeIntervalSinceReferenceDate)
                    }
                }
                .drawingGroup()
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    @ViewBuilder
    private func transparentLayer(time: TimeInterval) -> some View {
        GeometryReader { geo in
            let side = max(1, min(geo.size.width, geo.size.height))
            let clampedLevel = max(0.0, min(1.0, activityLevel))
            let baseline = isActive ? (0.26 + clampedLevel * 0.74) : 0.10
            let phase = time * (isActive ? 2.6 : 1.2)
            let pulse = 1.0 + sin(phase) * (isActive ? (0.03 + clampedLevel * 0.02) : 0.008)
            let glowOpacity = isActive ? (0.06 + clampedLevel * 0.10) : 0.03

            ZStack {
                if showPulseRings {
                    ForEach(0..<2, id: \.self) { ring in
                        let ringWave = (sin(phase * 1.8 + Double(ring) * 1.15) + 1.0) * 0.5
                        let ringScale = 1.0 + CGFloat(ring) * 0.12 + CGFloat(ringWave) * (0.08 + baseline * 0.12)
                        Circle()
                            .stroke(
                                JOIFirestormTheme.ringB.opacity(
                                    max(0.06, 0.16 - Double(ring) * 0.05 + clampedLevel * 0.18)
                                ),
                                lineWidth: max(0.8, side * (0.034 - CGFloat(ring) * 0.004))
                            )
                            .frame(
                                width: side * (0.84 + CGFloat(ring) * 0.16),
                                height: side * (0.84 + CGFloat(ring) * 0.16)
                            )
                            .scaleEffect(ringScale)
                    }
                }

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                JOIFirestormTheme.ringA.opacity(glowOpacity),
                                .clear,
                            ],
                            center: .center,
                            startRadius: side * 0.02,
                            endRadius: side * 0.48
                        )
                    )
                    .scaleEffect(1.04 + clampedLevel * (isActive ? 0.11 : 0.04))

                Image("JoiFirestormTransparent")
                    .resizable()
                    .interpolation(.high)
                    .antialiased(true)
                    .scaledToFit()
                    .padding(side * 0.02)
                    .saturation(0.86)
                    .brightness(-0.14)
                    .shadow(
                        color: JOIFirestormTheme.ringB.opacity(isActive ? 0.08 : 0.04),
                        radius: side * (isActive ? 0.035 : 0.02)
                    )
            }
            .frame(width: side, height: side)
            .scaleEffect(pulse)
        }
    }

    @ViewBuilder
    private func orbLayer(time: TimeInterval) -> some View {
        GeometryReader { geo in
            let side = max(1, min(geo.size.width, geo.size.height))
            let clampedLevel = max(0.0, min(1.0, activityLevel))
            let baseline = isActive ? (0.24 + clampedLevel * 0.76) : 0.10
            let phase = time * (isActive ? 2.4 : 1.2)

            ZStack {
                if showPulseRings {
                    ForEach(0..<3, id: \.self) { ring in
                        let ringPhase = phase + Double(ring) * 0.74
                        let ringPulse = 1.0 + sin(ringPhase) * 0.06 * baseline
                        let ringScale = ringPulse + CGFloat(ring) * 0.06 * baseline
                        Circle()
                            .stroke(
                                ringStrokeColor.opacity(
                                    max(0.08, 0.25 - Double(ring) * 0.06 + clampedLevel * 0.22)
                                ),
                                lineWidth: max(0.8, side * (0.054 - CGFloat(ring) * 0.01))
                            )
                            .frame(
                                width: side * (0.74 + CGFloat(ring) * 0.19),
                                height: side * (0.74 + CGFloat(ring) * 0.19)
                            )
                            .scaleEffect(ringScale)
                    }
                }

                Circle()
                    .fill(coreFill)

                Circle()
                    .stroke(ringStrokeColor.opacity(isActive ? 0.72 : 0.42), lineWidth: max(1.0, side * 0.062))

                JOITriangleMark()
                    .stroke(
                        ringStrokeColor.opacity(isActive ? 0.92 : 0.68),
                        style: StrokeStyle(
                            lineWidth: max(0.9, side * 0.066),
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )
                    .frame(width: side * 0.36, height: side * 0.34)
            }
            .frame(width: side, height: side)
        }
    }

    private var ringStrokeColor: Color {
        switch style {
        case .outline:
            return isActive ? JOIColors.textPrimary : JOIColors.textSecondary
        case .glow:
            return isActive ? JOIColors.primary : JOIColors.primaryMuted
        case .transparent:
            return isActive ? JOIFirestormTheme.ringB : JOIFirestormTheme.ringA
        case .firestorm:
            return isActive ? JOIColors.primary : JOIColors.primaryMuted
        }
    }

    private var coreFill: AnyShapeStyle {
        switch style {
        case .outline:
            return AnyShapeStyle(
                RadialGradient(
                    colors: [
                        JOIColors.textPrimary.opacity(isActive ? 0.13 : 0.07),
                        JOIColors.textPrimary.opacity(0.02),
                        .clear,
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: 48
                )
            )
        case .glow:
            return AnyShapeStyle(
                RadialGradient(
                    colors: [
                        JOIColors.primary.opacity(isActive ? 0.40 : 0.18),
                        JOIColors.primary.opacity(0.10),
                        JOIColors.background.opacity(0.90),
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: 52
                )
            )
        case .transparent:
            return AnyShapeStyle(Color.clear)
        case .firestorm:
            return AnyShapeStyle(Color.clear)
        }
    }

    private var firestormIntensity: CGFloat {
        let level = CGFloat(max(0.0, min(1.0, activityLevel)))
        if isActive {
            return max(0.26, min(0.70, 0.30 + level * 0.24))
        }
        return max(0.10, min(0.30, 0.14 + level * 0.14))
    }

    private var firestormSpeed: CGFloat {
        let level = CGFloat(max(0.0, min(1.0, activityLevel)))
        if isActive {
            return 0.76 + level * 0.96
        }
        return 0.42 + level * 0.30
    }
}

private struct JOITriangleMark: Shape {
    func path(in rect: CGRect) -> Path {
        let midX = rect.midX
        let topY = rect.minY + rect.height * 0.04
        let leftX = rect.minX + rect.width * 0.08
        let rightX = rect.maxX - rect.width * 0.08
        let bottomY = rect.maxY - rect.height * 0.06
        let insetY = rect.maxY - rect.height * 0.26

        var p = Path()
        p.move(to: CGPoint(x: midX, y: topY))
        p.addLine(to: CGPoint(x: rightX, y: bottomY))
        p.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.24, y: insetY))
        p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.24, y: insetY))
        p.addLine(to: CGPoint(x: leftX, y: bottomY))
        p.closeSubpath()
        return p
    }
}

private enum JOIFirestormTheme {
    static let halo = Color(red: 0.84, green: 0.30, blue: 0.06)
    static let ringA = Color(red: 0.90, green: 0.48, blue: 0.15)
    static let ringB = Color(red: 0.92, green: 0.66, blue: 0.36)
    static let core = Color(red: 0.95, green: 0.78, blue: 0.52)
}

/// Firestorm universe orb (fog + particles + outer sphere edge, no ribbon traces).
private struct JOIFirestormAvatar: View {
    let intensity: CGFloat
    let speed: CGFloat
    let animated: Bool

    var body: some View {
        Group {
            if animated {
                TimelineView(.animation(minimumInterval: 1.0 / 45.0)) { timeline in
                    layer(time: timeline.date.timeIntervalSinceReferenceDate)
                }
            } else {
                layer(time: Date.now.timeIntervalSinceReferenceDate)
            }
        }
    }

    @ViewBuilder
    private func layer(time: TimeInterval) -> some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let orbSide = side * 0.88
            let scaledTime = time * Double(max(0.2, speed))
            let pulse = 1.0 + sin(scaledTime * 3.0) * Double(intensity * 0.10)
            let ringWidth = side * 0.028

            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                JOIFirestormTheme.halo.opacity(0.24),
                                JOIFirestormTheme.halo.opacity(0.06),
                                .clear,
                            ],
                            center: .center,
                            startRadius: side * 0.03,
                            endRadius: side * 0.53
                        )
                    )

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                JOIFirestormTheme.halo.opacity(0.06),
                                .clear,
                            ],
                            center: .center,
                            startRadius: side * 0.20,
                            endRadius: side * 0.64
                        )
                    )
                    .blendMode(.screen)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.black.opacity(0.20),
                                Color.black.opacity(0.64),
                                Color.black.opacity(0.96),
                            ],
                            center: .center,
                            startRadius: side * 0.02,
                            endRadius: side * 0.46
                        )
                    )

                JOIFirestormNebula(time: scaledTime, intensity: intensity)
                    .clipShape(Circle())
                    .blendMode(.screen)

                JOIFirestormParticles(time: scaledTime, intensity: intensity)
                    .clipShape(Circle())
                    .blendMode(.screen)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                JOIFirestormTheme.core.opacity(0.42),
                                JOIFirestormTheme.ringB.opacity(0.30),
                                JOIFirestormTheme.ringA.opacity(0.14),
                                .clear,
                            ],
                            center: .center,
                            startRadius: side * 0.01,
                            endRadius: side * 0.22
                        )
                    )
                    .blendMode(.screen)

                Circle()
                    .stroke(JOIFirestormTheme.ringB.opacity(0.28), lineWidth: ringWidth)
                    .blur(radius: side * 0.009)
                    .blendMode(.screen)
            }
            .frame(width: orbSide, height: orbSide)
            .scaleEffect(pulse)
            .position(x: geo.size.width * 0.5, y: geo.size.height * 0.5)
            .drawingGroup()
        }
    }
}

private struct JOIFirestormNebula: View {
    let time: Double
    let intensity: CGFloat

    var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let radius = side * 0.46
            let center = CGPoint(x: size.width * 0.5, y: size.height * 0.5)

            context.drawLayer { layer in
                layer.blendMode = .screen
                layer.addFilter(.blur(radius: side * 0.032))

                let count = Int(120 + intensity * 90)
                for i in 0..<count {
                    let f = Double(i)
                    let seed = f * 0.618_033_988_75
                    let drift = 0.09 + seed.truncatingRemainder(dividingBy: 0.08)
                    let angle = seed * 8.7 + time * drift
                    let radialSeed = abs(sin(seed * 13.7))
                    let radial = CGFloat(pow(radialSeed, 0.62)) * radius
                    let x = center.x + cos(angle) * radial
                    let y = center.y + sin(angle) * radial
                    let pulse = 0.74 + sin(time * (0.55 + seed) + seed * 14.0) * 0.26
                    let cloudR = side * (0.08 + CGFloat(abs(sin(seed * 5.4))) * 0.22) * pulse

                    let color: Color
                    switch i % 5 {
                    case 0:
                        color = JOIFirestormTheme.halo.opacity(0.12)
                    case 1, 2:
                        color = JOIFirestormTheme.ringA.opacity(0.10)
                    case 3:
                        color = JOIFirestormTheme.ringB.opacity(0.10)
                    default:
                        color = JOIFirestormTheme.core.opacity(0.08)
                    }

                    let rect = CGRect(x: x - cloudR, y: y - cloudR, width: cloudR * 2, height: cloudR * 2)
                    layer.fill(Path(ellipseIn: rect), with: .color(color))
                }
            }
        }
    }
}

private struct JOIFirestormParticles: View {
    let time: Double
    let intensity: CGFloat

    var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let radius = side * 0.42
            let center = CGPoint(x: size.width * 0.5, y: size.height * 0.5)
            let count = Int(90 + intensity * 100)

            for i in 0..<count {
                let f = Double(i)
                let seed = f * 0.618_033_988_75
                let angle = seed * 11.0 + time * (0.2 + seed.truncatingRemainder(dividingBy: 0.7))
                let radialSeed = abs(sin(seed * 17.0))
                let radial = CGFloat(pow(radialSeed, 0.55)) * radius
                let x = center.x + cos(angle) * radial
                let y = center.y + sin(angle) * radial
                let twinkle = 0.3 + (sin(time * (1.1 + seed) + seed * 20.0) + 1.0) * 0.35
                let particleSize = max(0.5, CGFloat(0.6 + twinkle) * side * 0.0058)

                let rect = CGRect(
                    x: x - particleSize * 0.5,
                    y: y - particleSize * 0.5,
                    width: particleSize,
                    height: particleSize
                )

                let warm = i % 3 != 0
                let color = warm
                    ? JOIFirestormTheme.ringB.opacity(twinkle * 0.44)
                    : Color.white.opacity(twinkle * 0.30)

                context.fill(Path(ellipseIn: rect), with: .color(color))
            }
        }
    }
}
