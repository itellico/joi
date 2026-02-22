#!/usr/bin/env swift

import CoreGraphics
import Foundation
import ImageIO
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

struct IconSpec {
    let filename: String
    let size: Int
}

let iconSpecs: [IconSpec] = [
    IconSpec(filename: "Icon-App-20x20@1x.png", size: 20),
    IconSpec(filename: "Icon-App-20x20@2x.png", size: 40),
    IconSpec(filename: "Icon-App-20x20@3x.png", size: 60),
    IconSpec(filename: "Icon-App-29x29@1x.png", size: 29),
    IconSpec(filename: "Icon-App-29x29@2x.png", size: 58),
    IconSpec(filename: "Icon-App-29x29@3x.png", size: 87),
    IconSpec(filename: "Icon-App-40x40@1x.png", size: 40),
    IconSpec(filename: "Icon-App-40x40@2x.png", size: 80),
    IconSpec(filename: "Icon-App-40x40@3x.png", size: 120),
    IconSpec(filename: "Icon-App-60x60@2x.png", size: 120),
    IconSpec(filename: "Icon-App-60x60@3x.png", size: 180),
    IconSpec(filename: "Icon-App-76x76@1x.png", size: 76),
    IconSpec(filename: "Icon-App-76x76@2x.png", size: 152),
    IconSpec(filename: "Icon-App-83.5x83.5@2x.png", size: 167),
    IconSpec(filename: "Icon-App-1024x1024@1x.png", size: 1024),
]

let contentsJSON = """
{
  "images" : [
    { "size" : "20x20", "idiom" : "iphone", "filename" : "Icon-App-20x20@2x.png", "scale" : "2x" },
    { "size" : "20x20", "idiom" : "iphone", "filename" : "Icon-App-20x20@3x.png", "scale" : "3x" },
    { "size" : "29x29", "idiom" : "iphone", "filename" : "Icon-App-29x29@1x.png", "scale" : "1x" },
    { "size" : "29x29", "idiom" : "iphone", "filename" : "Icon-App-29x29@2x.png", "scale" : "2x" },
    { "size" : "29x29", "idiom" : "iphone", "filename" : "Icon-App-29x29@3x.png", "scale" : "3x" },
    { "size" : "40x40", "idiom" : "iphone", "filename" : "Icon-App-40x40@2x.png", "scale" : "2x" },
    { "size" : "40x40", "idiom" : "iphone", "filename" : "Icon-App-40x40@3x.png", "scale" : "3x" },
    { "size" : "60x60", "idiom" : "iphone", "filename" : "Icon-App-60x60@2x.png", "scale" : "2x" },
    { "size" : "60x60", "idiom" : "iphone", "filename" : "Icon-App-60x60@3x.png", "scale" : "3x" },
    { "size" : "20x20", "idiom" : "ipad", "filename" : "Icon-App-20x20@1x.png", "scale" : "1x" },
    { "size" : "20x20", "idiom" : "ipad", "filename" : "Icon-App-20x20@2x.png", "scale" : "2x" },
    { "size" : "29x29", "idiom" : "ipad", "filename" : "Icon-App-29x29@1x.png", "scale" : "1x" },
    { "size" : "29x29", "idiom" : "ipad", "filename" : "Icon-App-29x29@2x.png", "scale" : "2x" },
    { "size" : "40x40", "idiom" : "ipad", "filename" : "Icon-App-40x40@1x.png", "scale" : "1x" },
    { "size" : "40x40", "idiom" : "ipad", "filename" : "Icon-App-40x40@2x.png", "scale" : "2x" },
    { "size" : "76x76", "idiom" : "ipad", "filename" : "Icon-App-76x76@1x.png", "scale" : "1x" },
    { "size" : "76x76", "idiom" : "ipad", "filename" : "Icon-App-76x76@2x.png", "scale" : "2x" },
    { "size" : "83.5x83.5", "idiom" : "ipad", "filename" : "Icon-App-83.5x83.5@2x.png", "scale" : "2x" },
    { "size" : "1024x1024", "idiom" : "ios-marketing", "filename" : "Icon-App-1024x1024@1x.png", "scale" : "1x" }
  ],
  "info" : { "version" : 1, "author" : "xcode" }
}
"""

func destinationType() -> CFString {
    #if canImport(UniformTypeIdentifiers)
    return UTType.png.identifier as CFString
    #else
    return kUTTypePNG
    #endif
}

func usage() -> Never {
    print(
        """
        Usage:
          swift mobile/ios/IconKit/generate_appiconset.swift --source <1024_png> --out <AppIcon.appiconset>

        Example:
          swift mobile/ios/IconKit/generate_appiconset.swift \
            --source mobile/ios/IconKit/png/joi_orbit_orange.png \
            --out mobile/ios/IconKit/AppIcon-joi_orbit_orange.appiconset
        """
    )
    exit(1)
}

func parseArgs() -> (source: String, out: String) {
    var source: String?
    var out: String?
    var i = 1
    while i < CommandLine.arguments.count {
        switch CommandLine.arguments[i] {
        case "--source":
            guard i + 1 < CommandLine.arguments.count else { usage() }
            source = CommandLine.arguments[i + 1]
            i += 1
        case "--out":
            guard i + 1 < CommandLine.arguments.count else { usage() }
            out = CommandLine.arguments[i + 1]
            i += 1
        default:
            break
        }
        i += 1
    }
    guard let source, let out else { usage() }
    return (source, out)
}

func centerCropSquare(_ image: CGImage) -> CGImage {
    let w = image.width
    let h = image.height
    if w == h { return image }
    let side = min(w, h)
    let x = (w - side) / 2
    let y = (h - side) / 2
    let rect = CGRect(x: x, y: y, width: side, height: side)
    return image.cropping(to: rect) ?? image
}

func resize(_ image: CGImage, to size: Int) -> CGImage? {
    guard let ctx = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return nil
    }
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    return ctx.makeImage()
}

func writePNG(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, destinationType(), 1, nil) else {
        throw NSError(domain: "iconkit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot create PNG destination \(url.path)"])
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw NSError(domain: "iconkit", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot finalize PNG \(url.path)"])
    }
}

do {
    let args = parseArgs()
    let sourceURL = URL(fileURLWithPath: args.source)
    let outURL = URL(fileURLWithPath: args.out, isDirectory: true)

    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
          let sourceImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        throw NSError(domain: "iconkit", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not read source image \(sourceURL.path)"])
    }

    let squareSource = centerCropSquare(sourceImage)

    try FileManager.default.createDirectory(at: outURL, withIntermediateDirectories: true)

    for spec in iconSpecs {
        guard let resized = resize(squareSource, to: spec.size) else {
            throw NSError(domain: "iconkit", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not resize to \(spec.size)"])
        }
        try writePNG(resized, to: outURL.appendingPathComponent(spec.filename))
    }

    try contentsJSON.write(
        to: outURL.appendingPathComponent("Contents.json"),
        atomically: true,
        encoding: .utf8
    )

    print("Generated AppIcon set at \(outURL.path)")
} catch {
    fputs("Error: \(error)\n", stderr)
    exit(1)
}
