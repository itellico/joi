# JOI Icon Pack (Blade-Runner-Inspired)

Generated asset pack for iOS/Flutter handoff.

## What You Get

- 10 icon variants in PNG (`1024`, `512`, `256`)
- 10 editable SVG variants
- 3 transparent animation layers (core / rings / particles)

Main folders:

- `mobile/assets/icons/joi_pack/png`
- `mobile/assets/icons/joi_pack/svg`

## Recommended Files

- App icon (color): `mobile/assets/icons/joi_pack/png/joi_orbit_orange.png`
- App icon (2-color): `mobile/assets/icons/joi_pack/png/joi_orbit_bw.png`
- App icon (inverse): `mobile/assets/icons/joi_pack/png/joi_orbit_bw_inverse.png`
- Transparent animation layers:
  - `mobile/assets/icons/joi_pack/png/joi_layer_core_transparent_512.png`
  - `mobile/assets/icons/joi_pack/png/joi_layer_rings_transparent_512.png`
  - `mobile/assets/icons/joi_pack/png/joi_layer_particles_transparent_512.png`

## Re-Generate Assets

From repo root:

```bash
mkdir -p /tmp/swift-module-cache /tmp/clang-module-cache
SWIFT_MODULECACHE_PATH=/tmp/swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache \
swift mobile/scripts/generate_joi_icon_pack.swift --out mobile/assets/icons/joi_pack
```

## Install into iOS AppIcon.appiconset

This writes all required iPhone/iPad marketing icon sizes directly into:

- `mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset`

Command:

```bash
mkdir -p /tmp/swift-module-cache /tmp/clang-module-cache
SWIFT_MODULECACHE_PATH=/tmp/swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache \
swift mobile/scripts/generate_joi_icon_pack.swift \
  --out mobile/assets/icons/joi_pack \
  --install-ios-appicon \
  --ios-variant joi_orbit_orange
```

Swap `joi_orbit_orange` with any generated variant name if needed.

## In-App Animated Orb

A ready widget is included:

- `mobile/lib/shared/widgets/joi_orb.dart`

It uses transparent layer assets and supports:

- idle rotation
- pulse by `intensity`
- faster rotation when `isProcessing = true`
