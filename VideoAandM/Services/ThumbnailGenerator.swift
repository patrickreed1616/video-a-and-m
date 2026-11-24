import AVFoundation
import CoreGraphics

/// Generates and caches small frames for the video clip blocks on the timeline.
actor ThumbnailGenerator {
    static let shared = ThumbnailGenerator()

    private var cache: [String: CGImage] = [:]
    private var generators: [URL: AVAssetImageGenerator] = [:]

    /// Returns a frame near `seconds`. Times are rounded to 0.5 s so trimming reuses cached frames.
    func thumbnail(for url: URL, at seconds: Double, maxHeight: CGFloat = 80) async -> CGImage? {
        let rounded = (seconds * 2).rounded() / 2
        let key = "\(url.path)#\(rounded)"
        if let cached = cache[key] { return cached }

        let generator = generator(for: url, maxHeight: maxHeight)
        guard let result = try? await generator.image(at: rounded.cmTime) else { return nil }
        if cache.count > 600 { cache.removeAll(keepingCapacity: true) }
        cache[key] = result.image
        return result.image
    }

    private func generator(for url: URL, maxHeight: CGFloat) -> AVAssetImageGenerator {
        if let existing = generators[url] { return existing }
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: maxHeight * 2 * 16 / 9, height: maxHeight * 2) // @2x
        let tolerance = CMTime(seconds: 0.25, preferredTimescale: 600)
        generator.requestedTimeToleranceBefore = tolerance
        generator.requestedTimeToleranceAfter = tolerance
        generators[url] = generator
        return generator
    }
}
