import SwiftUI

/// Top-bar sized JOI orb for iOS/macOS app chrome.
public struct JoiUniverseTopBarOrb: View {
    public var size: CGFloat
    public var intensity: CGFloat
    public var speed: CGFloat
    public var theme: JoiUniverseOrbView.Theme

    public init(
        size: CGFloat = 30,
        intensity: CGFloat = 0.42,
        speed: CGFloat = 1.0,
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

public extension View {
    /// Adds the pulsating JOI orb in the navigation top bar center.
    func joiUniverseTopBarOrb(
        size: CGFloat = 30,
        intensity: CGFloat = 0.42,
        speed: CGFloat = 1.0,
        theme: JoiUniverseOrbView.Theme = .orange
    ) -> some View {
        toolbar {
            ToolbarItem(placement: .principal) {
                JoiUniverseTopBarOrb(
                    size: size,
                    intensity: intensity,
                    speed: speed,
                    theme: theme
                )
            }
        }
    }

    /// Adds an audio-reactive JOI orb in the navigation top bar center.
    func joiMicReactiveTopBarOrb(
        mode: JoiAudioDriveMode = .simulate,
        manualLevel: CGFloat = 0,
        size: CGFloat = 30,
        baseIntensity: CGFloat = 0.28,
        baseSpeed: CGFloat = 0.7,
        reactiveIntensityBoost: CGFloat = 1.05,
        reactiveSpeedBoost: CGFloat = 1.6,
        audioGain: CGFloat = 5.0,
        audioGate: CGFloat = 0.01,
        audioInfluence: CGFloat = 1.35,
        theme: JoiUniverseOrbView.Theme = .orange
    ) -> some View {
        toolbar {
            ToolbarItem(placement: .principal) {
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
    }
}

#if canImport(UIKit)
import UIKit

public extension UINavigationItem {
    /// UIKit bridge to put the JOI orb in a navigation bar title view.
    func setJoiUniverseOrbTitleView(
        size: CGFloat = 30,
        intensity: CGFloat = 0.42,
        speed: CGFloat = 1.0,
        theme: JoiUniverseOrbView.Theme = .orange
    ) {
        let orbView = JoiUniverseTopBarOrb(
            size: size,
            intensity: intensity,
            speed: speed,
            theme: theme
        )
        let host = UIHostingController(rootView: orbView)
        host.view.backgroundColor = .clear
        host.view.frame = CGRect(x: 0, y: 0, width: size, height: size)
        titleView = host.view
    }

    /// UIKit bridge for audio-reactive top bar orb.
    func setJoiMicReactiveOrbTitleView(
        mode: JoiAudioDriveMode = .simulate,
        manualLevel: CGFloat = 0,
        size: CGFloat = 30,
        baseIntensity: CGFloat = 0.28,
        baseSpeed: CGFloat = 0.7,
        reactiveIntensityBoost: CGFloat = 1.05,
        reactiveSpeedBoost: CGFloat = 1.6,
        audioGain: CGFloat = 5.0,
        audioGate: CGFloat = 0.01,
        audioInfluence: CGFloat = 1.35,
        theme: JoiUniverseOrbView.Theme = .orange
    ) {
        let orbView = JoiMicReactiveOrbView(
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
        let host = UIHostingController(rootView: orbView)
        host.view.backgroundColor = .clear
        host.view.frame = CGRect(x: 0, y: 0, width: size, height: size)
        titleView = host.view
    }
}
#endif
