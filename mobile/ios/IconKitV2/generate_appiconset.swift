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

func usage() -> Never {
    print(
        """
        Usage:
          swift mobile/ios/IconKitV2/generate_appiconset.swift --source <1024_png> --out <AppIcon.appiconset>
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
    if image.width == image.height { return image }
    let side = min(image.width, image.height)
    let x = (image.width - side) / 2
    let y = (image.height - side) / 2
    return image.cropping(to: CGRect(x: x, y: y, width: side, height: side)) ?? image
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

func pngType() -> CFString {
    #if canImport(UniformTypeIdentifiers)
    return UTType.png.identifier as CFString
    #else
    return kUTTypePNG
    #endif
}

func writePNG(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, pngType(), 1, nil) else {
        throw NSError(domain: "iconkitv2", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot create PNG destination for \(url.path)"])
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw NSError(domain: "iconkitv2", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot finalize \(url.path)"])
    }
}

do {
    let args = parseArgs()
    let sourceURL = URL(fileURLWithPath: args.source)
    let outURL = URL(fileURLWithPath: args.out, isDirectory: true)

    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
          let sourceImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "iconkitv2", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to read \(sourceURL.path)"])
    }

    let squareSource = centerCropSquare(sourceImage)
    try FileManager.default.createDirectory(at: outURL, withIntermediateDirectories: true)

    for spec in iconSpecs {
        guard let image = resize(squareSource, to: spec.size) else {
            throw NSError(domain: "iconkitv2", code: 4, userInfo: [NSLocalizedDescriptionKey: "Resize failed for \(spec.size)"])
        }
        try writePNG(image, to: outURL.appendingPathComponent(spec.filename))
    }

    try contentsJSON.write(to: outURL.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
    print("Generated AppIcon set at \(outURL.path)")
} catch {
    fputs("Error: \(error)\n", stderr)
    exit(1)
}
