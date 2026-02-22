#!/usr/bin/env swift

import CoreGraphics
import Foundation
import ImageIO
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

enum RenderError: Error {
    case contextCreationFailed
    case imageCreationFailed
    case destinationCreationFailed(String)
    case destinationFinalizeFailed(String)
}

struct Palette {
    let name: String
    let bgOuter: Int
    let bgInner: Int
    let halo: Int
    let ringA: Int
    let ringB: Int
    let core: Int
    let phase: Double
}

let palettes: [Palette] = [
    Palette(name: "universe_orange_flare", bgOuter: 0x07090E, bgInner: 0x171E2B, halo: 0xFF5B0A, ringA: 0xFF8B2A, ringB: 0xFFD48A, core: 0xFFE7C5, phase: 0.10),
    Palette(name: "universe_orange_pulse", bgOuter: 0x06070D, bgInner: 0x1A1625, halo: 0xFF4D00, ringA: 0xFF7A1E, ringB: 0xFFBE6B, core: 0xFFD8A1, phase: 0.52),
    Palette(name: "universe_ember_core", bgOuter: 0x0A0807, bgInner: 0x26140D, halo: 0xFF5F00, ringA: 0xFF8C28, ringB: 0xFFD38D, core: 0xFFE0B2, phase: 1.05),
    Palette(name: "universe_firestorm", bgOuter: 0x08080A, bgInner: 0x2A1212, halo: 0xFF3E00, ringA: 0xFF6B12, ringB: 0xFFA45F, core: 0xFFD3AF, phase: 1.40),
    Palette(name: "universe_gold_holo", bgOuter: 0x07080B, bgInner: 0x1E1C12, halo: 0xFF8A00, ringA: 0xFFAD2A, ringB: 0xFFE2A2, core: 0xFFF2D7, phase: 1.95),
    Palette(name: "universe_siri_blue", bgOuter: 0x05070D, bgInner: 0x102239, halo: 0x137DFF, ringA: 0x28B0FF, ringB: 0x96F0FF, core: 0xD8F5FF, phase: 2.35),
    Palette(name: "universe_aurora_mix", bgOuter: 0x05080E, bgInner: 0x152C2E, halo: 0x14B0A0, ringA: 0x31D6BF, ringB: 0x9CFBE7, core: 0xE4FFF7, phase: 2.75),
    Palette(name: "universe_bw_luxe", bgOuter: 0x070707, bgInner: 0x171717, halo: 0xA9A9A9, ringA: 0xD9D9D9, ringB: 0xFFFFFF, core: 0xFFFFFF, phase: 3.15),
]

struct RNG {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed == 0 ? 0x9E3779B97F4A7C15 : seed
    }

    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state
    }

    mutating func unit() -> Double {
        let value = next() >> 11
        return Double(value) / Double(1 << 53)
    }
}

func rgb(_ hex: Int) -> (CGFloat, CGFloat, CGFloat) {
    let r = CGFloat((hex >> 16) & 0xFF) / 255
    let g = CGFloat((hex >> 8) & 0xFF) / 255
    let b = CGFloat(hex & 0xFF) / 255
    return (r, g, b)
}

func color(_ hex: Int, alpha: CGFloat = 1) -> CGColor {
    let (r, g, b) = rgb(hex)
    return CGColor(red: r, green: g, blue: b, alpha: alpha)
}

func blendColor(_ a: Int, _ b: Int, _ t: CGFloat, alpha: CGFloat = 1) -> CGColor {
    let c = max(0, min(1, t))
    let (ar, ag, ab) = rgb(a)
    let (br, bg, bb) = rgb(b)
    return CGColor(
        red: ar + (br - ar) * c,
        green: ag + (bg - ag) * c,
        blue: ab + (bb - ab) * c,
        alpha: alpha
    )
}

func drawBackground(_ ctx: CGContext, size: CGFloat, palette: Palette) {
    let rect = CGRect(x: 0, y: 0, width: size, height: size)
    ctx.setFillColor(color(palette.bgOuter))
    ctx.fill(rect)

    if let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            color(palette.bgOuter, alpha: 1),
            color(palette.bgInner, alpha: 1),
        ] as CFArray,
        locations: [0, 1]
    ) {
        ctx.drawLinearGradient(
            gradient,
            start: CGPoint(x: size * 0.08, y: size * 0.06),
            end: CGPoint(x: size * 0.92, y: size * 0.94),
            options: []
        )
    }

    // Distant nebula haze in the background for depth.
    let distantClouds: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
        (0.14, 0.20, 0.44, 0.25),
        (0.83, 0.18, 0.38, 0.20),
        (0.26, 0.82, 0.36, 0.14),
        (0.76, 0.78, 0.42, 0.13),
    ]
    for cloud in distantClouds {
        if let cloudGrad = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: [
                color(palette.halo, alpha: cloud.3),
                color(palette.halo, alpha: 0),
            ] as CFArray,
            locations: [0, 1]
        ) {
            let center = CGPoint(x: size * cloud.0, y: size * cloud.1)
            ctx.drawRadialGradient(
                cloudGrad,
                startCenter: center,
                startRadius: size * 0.02,
                endCenter: center,
                endRadius: size * cloud.2,
                options: []
            )
        }
    }

    if let vignette = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            color(0x000000, alpha: 0),
            color(0x000000, alpha: 0.34),
        ] as CFArray,
        locations: [0.52, 1]
    ) {
        let center = CGPoint(x: size * 0.5, y: size * 0.5)
        ctx.drawRadialGradient(
            vignette,
            startCenter: center,
            startRadius: size * 0.03,
            endCenter: center,
            endRadius: size * 0.77,
            options: []
        )
    }
}

func drawNebulaClouds(_ ctx: CGContext, center: CGPoint, radius: CGFloat, palette: Palette, seed: UInt64) {
    var rng = RNG(seed: seed ^ 0xBEEFCACE1234)
    ctx.saveGState()
    ctx.setBlendMode(.screen)

    // Layered fog puffs.
    for i in 0..<168 {
        let theta = CGFloat(rng.unit() * .pi * 2)
        let radial = CGFloat(pow(rng.unit(), 0.62)) * radius * 0.97
        let x = center.x + cos(theta) * radial
        let y = center.y + sin(theta) * radial
        let puff = radius * CGFloat(0.17 + rng.unit() * 0.60)
        let mix = CGFloat(rng.unit())

        let baseTone: CGColor
        if i % 11 == 0 {
            baseTone = blendColor(palette.core, palette.ringB, mix, alpha: CGFloat(0.16 + rng.unit() * 0.26))
        } else if i % 7 == 0 {
            baseTone = blendColor(palette.halo, palette.ringA, mix, alpha: CGFloat(0.18 + rng.unit() * 0.26))
        } else {
            baseTone = blendColor(palette.ringA, palette.ringB, mix, alpha: CGFloat(0.15 + rng.unit() * 0.25))
        }

        if let grad = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: [
                baseTone,
                baseTone.copy(alpha: 0) ?? color(palette.ringA, alpha: 0),
            ] as CFArray,
            locations: [0, 1]
        ) {
            ctx.drawRadialGradient(
                grad,
                startCenter: CGPoint(x: x, y: y),
                startRadius: puff * 0.05,
                endCenter: CGPoint(x: x, y: y),
                endRadius: puff,
                options: []
            )
        }
    }

    ctx.restoreGState()
}

func drawParticles(_ ctx: CGContext, center: CGPoint, radius: CGFloat, palette: Palette, seed: UInt64) {
    var rng = RNG(seed: seed ^ 0xA1A2A3A4A5A6)
    ctx.saveGState()
    ctx.setBlendMode(.screen)

    // Fine star field.
    for _ in 0..<180 {
        let theta = CGFloat(rng.unit() * .pi * 2)
        let radial = CGFloat(pow(rng.unit(), 0.55)) * radius * 0.98
        let x = center.x + cos(theta) * radial
        let y = center.y + sin(theta) * radial
        let size = max(0.55, CGFloat(rng.unit()) * radius * 0.010)
        let alpha = CGFloat(0.10 + rng.unit() * 0.58)
        let useWarm = rng.unit() > 0.42
        let c = useWarm ? blendColor(palette.ringB, palette.ringA, CGFloat(rng.unit()), alpha: alpha) : color(0xFFFFFF, alpha: alpha * 0.9)
        ctx.setFillColor(c)
        ctx.fillEllipse(in: CGRect(x: x - size * 0.5, y: y - size * 0.5, width: size, height: size))
    }

    // Brighter floating glows.
    for _ in 0..<78 {
        let theta = CGFloat(rng.unit() * .pi * 2)
        let radial = CGFloat(pow(rng.unit(), 0.72)) * radius * 0.86
        let x = center.x + cos(theta) * radial
        let y = center.y + sin(theta) * radial
        let size = radius * CGFloat(0.015 + rng.unit() * 0.030)
        let alpha = CGFloat(0.16 + rng.unit() * 0.34)
        let warm = blendColor(palette.ringA, palette.ringB, CGFloat(rng.unit()), alpha: alpha)
        if let glimmer = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: [
                warm,
                warm.copy(alpha: 0) ?? color(palette.ringA, alpha: 0),
            ] as CFArray,
            locations: [0, 1]
        ) {
            ctx.drawRadialGradient(
                glimmer,
                startCenter: CGPoint(x: x, y: y),
                startRadius: size * 0.10,
                endCenter: CGPoint(x: x, y: y),
                endRadius: size,
                options: []
            )
        }
    }

    ctx.restoreGState()
}

func drawUniverseOrb(_ ctx: CGContext, size: CGFloat, palette: Palette, seed: UInt64) {
    let center = CGPoint(x: size * 0.5, y: size * 0.5)
    let radius = size * 0.365

    // Multi-layer outer atmosphere glow.
    let halos: [(CGFloat, CGFloat)] = [
        (1.70, 0.56),
        (1.34, 0.40),
        (0.98, 0.28),
    ]
    for halo in halos {
        if let gradient = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: [
                color(palette.halo, alpha: halo.1),
                color(palette.halo, alpha: 0),
            ] as CFArray,
            locations: [0, 1]
        ) {
            ctx.drawRadialGradient(
                gradient,
                startCenter: center,
                startRadius: radius * 0.06,
                endCenter: center,
                endRadius: radius * halo.0,
                options: []
            )
        }
    }

    ctx.saveGState()
    ctx.addEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    ctx.clip()

    if let coreGradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            color(0x000000, alpha: 0.02),
            color(palette.bgInner, alpha: 0.40),
            color(palette.bgOuter, alpha: 0.90),
        ] as CFArray,
        locations: [0, 0.48, 1]
    ) {
        ctx.drawRadialGradient(
            coreGradient,
            startCenter: center,
            startRadius: radius * 0.03,
            endCenter: center,
            endRadius: radius * 1.05,
            options: []
        )
    }

    drawNebulaClouds(ctx, center: center, radius: radius, palette: palette, seed: seed)
    drawParticles(ctx, center: center, radius: radius, palette: palette, seed: seed)

    if let nucleus = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            color(palette.core, alpha: 0.96),
            color(palette.ringB, alpha: 0.70),
            color(palette.ringA, alpha: 0.42),
            color(palette.ringA, alpha: 0),
        ] as CFArray,
        locations: [0, 0.18, 0.42, 1]
    ) {
        ctx.drawRadialGradient(
            nucleus,
            startCenter: center,
            startRadius: radius * 0.01,
            endCenter: center,
            endRadius: radius * 0.52,
            options: []
        )
    }

    ctx.restoreGState()

    // Orb shell highlight.
    ctx.saveGState()
    ctx.setBlendMode(.screen)
    ctx.setStrokeColor(color(palette.ringB, alpha: 0.60))
    ctx.setLineWidth(radius * 0.034)
    ctx.setShadow(offset: .zero, blur: radius * 0.11, color: color(palette.ringB, alpha: 0.45))
    ctx.addEllipse(in: CGRect(x: center.x - radius * 1.01, y: center.y - radius * 1.01, width: radius * 2.02, height: radius * 2.02))
    ctx.strokePath()
    ctx.restoreGState()
}

func renderIcon(size: Int, palette: Palette, seed: UInt64) throws -> CGImage {
    guard let ctx = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw RenderError.contextCreationFailed
    }
    let dim = CGFloat(size)
    drawBackground(ctx, size: dim, palette: palette)
    drawUniverseOrb(ctx, size: dim, palette: palette, seed: seed)
    guard let image = ctx.makeImage() else {
        throw RenderError.imageCreationFailed
    }
    return image
}

func writePNG(_ image: CGImage, to url: URL) throws {
    let destinationType: CFString
    #if canImport(UniformTypeIdentifiers)
    destinationType = UTType.png.identifier as CFString
    #else
    destinationType = kUTTypePNG
    #endif

    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, destinationType, 1, nil) else {
        throw RenderError.destinationCreationFailed(url.path)
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw RenderError.destinationFinalizeFailed(url.path)
    }
}

func parseArgs() -> String {
    var outPath = "mobile/ios/IconKitV2/png"
    var idx = 1
    while idx < CommandLine.arguments.count {
        if CommandLine.arguments[idx] == "--out", idx + 1 < CommandLine.arguments.count {
            outPath = CommandLine.arguments[idx + 1]
            idx += 1
        }
        idx += 1
    }
    return outPath
}

func run() throws {
    let outPath = parseArgs()
    let outDir = URL(fileURLWithPath: outPath, isDirectory: true)
    try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

    var generated: [String] = []
    for (index, palette) in palettes.enumerated() {
        let baseSeed = UInt64(0xA11CE000 + index * 7919)
        for size in [1024, 512, 256] {
            let image = try renderIcon(size: size, palette: palette, seed: baseSeed &+ UInt64(size))
            let filename = size == 1024 ? "\(palette.name).png" : "\(palette.name)_\(size).png"
            let fileURL = outDir.appendingPathComponent(filename)
            try writePNG(image, to: fileURL)
            generated.append(fileURL.lastPathComponent)
        }
    }

    let manifest = """
    Generated \(generated.count) files

    \(generated.sorted().map { "- \($0)" }.joined(separator: "\n"))
    """
    try manifest.write(
        to: URL(fileURLWithPath: outPath, isDirectory: true).deletingLastPathComponent().appendingPathComponent("MANIFEST.txt"),
        atomically: true,
        encoding: .utf8
    )

    print("Generated \(generated.count) icons in \(outPath)")
}

do {
    try run()
} catch {
    fputs("Error: \(error)\n", stderr)
    exit(1)
}
