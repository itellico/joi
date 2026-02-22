# JOI Universe Icon Kit V2

This is the rebuilt Siri-style universe set (fog + particles only, no ribbon/worm traces).

## 1) See the moving version now

Open:

- `mobile/ios/IconKitV2/preview.html`

It includes:

- live animated orb
- preset switching
- speed/energy/particle controls
- fog intensity control
- export mode: `Full Scene` or `Transparent Circle`
- audio drive mode: `Manual`, `Simulate Speech`, `Use Microphone`
- audio calibration sliders: `Audio Gain`, `Audio Gate`, `Audio Influence`
- export current frame as `1024x1024` PNG

## 2) Generate high-quality static icon variants

```bash
mkdir -p /tmp/swift-module-cache /tmp/clang-module-cache
SWIFT_MODULECACHE_PATH=/tmp/swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache \
swift mobile/ios/IconKitV2/generate_universe_icons.swift --out mobile/ios/IconKitV2/png
```

Generated base files:

- `mobile/ios/IconKitV2/png/universe_orange_flare.png`
- `mobile/ios/IconKitV2/png/universe_orange_pulse.png`
- `mobile/ios/IconKitV2/png/universe_ember_core.png`
- `mobile/ios/IconKitV2/png/universe_firestorm.png`
- `mobile/ios/IconKitV2/png/universe_gold_holo.png`
- `mobile/ios/IconKitV2/png/universe_siri_blue.png`
- `mobile/ios/IconKitV2/png/universe_aurora_mix.png`
- `mobile/ios/IconKitV2/png/universe_bw_luxe.png`

Each also has `_512` and `_256` previews.

## 3) Create `AppIcon.appiconset` for Xcode

```bash
mkdir -p /tmp/swift-module-cache /tmp/clang-module-cache
SWIFT_MODULECACHE_PATH=/tmp/swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache \
swift mobile/ios/IconKitV2/generate_appiconset.swift \
  --source mobile/ios/IconKitV2/png/universe_orange_flare.png \
  --out mobile/ios/IconKitV2/AppIconSets/AppIcon-universe_orange_flare.appiconset
```

Then copy generated files into your iOS project's `AppIcon.appiconset`.

## 4) Use your exported Firestorm frame as app icon

Detected export:

- `/Users/mm2/Downloads/joi_universe_firestorm_frame (1).png` (latest)
- mirrored at `mobile/ios/IconKitV2/source/joi_universe_firestorm_frame_latest.png`

Generated from that exact file:

- `mobile/ios/IconKitV2/AppIconSets/AppIcon-user-firestorm-export.appiconset`

Installed into iOS runner:

- `mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset`

If you need to regenerate from a new export:

```bash
mkdir -p /tmp/swift-module-cache /tmp/clang-module-cache
SWIFT_MODULECACHE_PATH=/tmp/swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache \
swift mobile/ios/IconKitV2/generate_appiconset.swift \
  --source \"/Users/mm2/Downloads/joi_universe_firestorm_frame (1).png\" \
  --out mobile/ios/IconKitV2/AppIconSets/AppIcon-user-firestorm-export.appiconset
```

## 5) Native iOS top-bar pulsating orb

Files:

- `mobile/ios/IconKitV2/JoiUniverseOrbView.swift`
- `mobile/ios/IconKitV2/NativeIntegration/JoiUniverseTopBar.swift`
- `mobile/ios/IconKitV2/NativeIntegration/JoiMicrophoneLevelMonitor.swift`
- `mobile/ios/IconKitV2/NativeIntegration/JoiMicReactiveOrb.swift`

SwiftUI example:

```swift
import SwiftUI

struct ChatView: View {
    var body: some View {
        List {
            Text("Messages")
        }
        .navigationTitle("")
        .joiUniverseTopBarOrb(
            size: 32,
            intensity: 0.45,
            speed: 1.0,
            theme: .orange
        )
    }
}
```

UIKit example:

```swift
override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.setJoiUniverseOrbTitleView(
        size: 30,
        intensity: 0.45,
        speed: 1.0,
        theme: .orange
    )
}
```

Audio-reactive SwiftUI top-bar example:

```swift
import SwiftUI

struct ChatView: View {
    @State private var mode: JoiAudioDriveMode = .simulate

    var body: some View {
        List {
            Text("Messages")
        }
        .navigationTitle("")
        .joiMicReactiveTopBarOrb(
            mode: mode,
            size: 32,
            theme: .orange
        )
    }
}
```

Audio-reactive UIKit example:

```swift
override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.setJoiMicReactiveOrbTitleView(
        mode: .microphone,
        size: 30,
        theme: .orange
    )
}
```

For microphone mode on iOS, add `NSMicrophoneUsageDescription` to your `Info.plist`.

If browser mic behavior looks weak on `file://`, run from localhost:

```bash
cd mobile/ios/IconKitV2
python3 -m http.server 8787
```

Then open `http://localhost:8787/preview.html`.

## 6) Watch integration

File:

- `mobile/ios/IconKitV2/NativeIntegration/JoiUniverseWatch.swift`

watchOS SwiftUI example:

```swift
import SwiftUI

struct WatchHomeView: View {
    var body: some View {
        JoiUniverseWatchHeader(theme: .orange) {
            Text("JOI")
                .font(.caption2)
        }
    }
}
```

Reactive watch example:

```swift
import SwiftUI

struct WatchHomeView: View {
    var body: some View {
        JoiReactiveWatchOrb(mode: .simulate, size: 22, theme: .orange)
    }
}
```

## 7) Recommended pick

Start with:

- `universe_orange_flare` (Blade Runner style)
- `universe_siri_blue` (closest Siri vibe)
