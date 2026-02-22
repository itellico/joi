# JOI iOS Icon Kit

This folder is iOS-only and ready for handoff.

## 1) View icon variants now

Open:

- `mobile/ios/IconKit/gallery.html`

It shows all 10 variants and has direct PNG/SVG download links.

## 2) Pick source icon (1024x1024)

Recommended:

- `mobile/ios/IconKit/png/joi_orbit_orange.png`

Other options include:

- `mobile/ios/IconKit/png/joi_minimal_apple_like.png`
- `mobile/ios/IconKit/png/joi_orbit_bw.png`
- `mobile/ios/IconKit/png/joi_dual_faces_orange.png`

## 3) Generate AppIcon.appiconset for Xcode

From repo root:

```bash
mkdir -p /tmp/swift-module-cache /tmp/clang-module-cache
SWIFT_MODULECACHE_PATH=/tmp/swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache \
swift mobile/ios/IconKit/generate_appiconset.swift \
  --source mobile/ios/IconKit/png/joi_orbit_orange.png \
  --out mobile/ios/IconKit/AppIcon-joi_orbit_orange.appiconset
```

This creates all required iPhone/iPad + App Store icon sizes and a matching `Contents.json`.

## 4) Put into your iOS project

Replace your `AppIcon.appiconset` files with the generated set:

- `mobile/ios/IconKit/AppIcon-joi_orbit_orange.appiconset/*`

## Transparent assets for in-app animation

Use these in native iOS UI for animated orb layers:

- `mobile/ios/IconKit/png/joi_layer_core_transparent_512.png`
- `mobile/ios/IconKit/png/joi_layer_rings_transparent_512.png`
- `mobile/ios/IconKit/png/joi_layer_particles_transparent_512.png`
