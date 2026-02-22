import SwiftUI

/// Watch-friendly orb variants using the same visual language.
public struct JoiUniverseWatchOrb: View {
    public var size: CGFloat
    public var intensity: CGFloat
    public var speed: CGFloat
    public var theme: JoiUniverseOrbView.Theme

    public init(
        size: CGFloat = 24,
        intensity: CGFloat = 0.34,
        speed: CGFloat = 0.9,
        theme: JoiUniverseOrbView.Theme = .orange
    ) {
        self.size = size
        self.intensity = intensity
        self.speed = speed
        self.theme = theme
    }

    public var body: some View {
        JoiUniverseOrbView(intensity: intensity, speed: speed, theme: theme)
            .frame(width: size, height: size)
    }
}

public struct JoiReactiveWatchOrb: View {
    public var mode: JoiAudioDriveMode
    public var manualLevel: CGFloat
    public var size: CGFloat
    public var baseIntensity: CGFloat
    public var baseSpeed: CGFloat
    public var reactiveIntensityBoost: CGFloat
    public var reactiveSpeedBoost: CGFloat
    public var audioGain: CGFloat
    public var audioGate: CGFloat
    public var audioInfluence: CGFloat
    public var theme: JoiUniverseOrbView.Theme

    public init(
        mode: JoiAudioDriveMode = .simulate,
        manualLevel: CGFloat = 0,
        size: CGFloat = 24,
        baseIntensity: CGFloat = 0.28,
        baseSpeed: CGFloat = 0.72,
        reactiveIntensityBoost: CGFloat = 0.90,
        reactiveSpeedBoost: CGFloat = 1.20,
        audioGain: CGFloat = 5.0,
        audioGate: CGFloat = 0.01,
        audioInfluence: CGFloat = 1.30,
        theme: JoiUniverseOrbView.Theme = .orange
    ) {
        self.mode = mode
        self.manualLevel = manualLevel
        self.size = size
        self.baseIntensity = baseIntensity
        self.baseSpeed = baseSpeed
        self.reactiveIntensityBoost = reactiveIntensityBoost
        self.reactiveSpeedBoost = reactiveSpeedBoost
        self.audioGain = audioGain
        self.audioGate = audioGate
        self.audioInfluence = audioInfluence
        self.theme = theme
    }

    public var body: some View {
        JoiMicReactiveOrbView(
            mode: mode,
            manualLevel: manualLevel,
            size: size,
            baseIntensity: baseIntensity,
            baseSpeed: baseSpeed,
            reactiveIntensityBoost: reactiveIntensityBoost,
            reactiveSpeedBoost: reactiveSpeedBoost,
            audioGain: audioGain,
            audioGate: audioGate,
            audioInfluence: audioInfluence,
            theme: theme
        )
    }
}

public struct JoiUniverseWatchHeader<Content: View>: View {
    private let content: Content
    private let theme: JoiUniverseOrbView.Theme

    public init(
        theme: JoiUniverseOrbView.Theme = .orange,
        @ViewBuilder content: () -> Content
    ) {
        self.theme = theme
        self.content = content()
    }

    public var body: some View {
        VStack(spacing: 8) {
            JoiUniverseWatchOrb(size: 22, intensity: 0.34, speed: 0.85, theme: theme)
            content
        }
    }
}
