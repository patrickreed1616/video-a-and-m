import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins

/// Everything a player item or an exporter needs, built from the timeline model.
struct BuiltComposition {
    let composition: AVMutableComposition
    /// nil when there is no video on the timeline.
    let videoComposition: AVMutableVideoComposition?
    let audioMix: AVMutableAudioMix?
    /// Upright size of the first video clip (after its preferredTransform).
    let naturalRenderSize: CGSize
}

enum CompositionError: LocalizedError {
    case noVideoTrack(URL)
    case cannotCreateTrack

    var errorDescription: String? {
        switch self {
        case .noVideoTrack(let url): return "\(url.lastPathComponent) has no video track."
        case .cannotCreateTrack: return "Could not create a composition track."
        }
    }
}

/// Turns a `Project` into an AVMutableComposition (+ video composition for lighting, + audio mix).
enum CompositionBuilder {
    static let musicFadeOut: Double = 0.5

    static func build(project: Project, maxPreviewWidth: CGFloat? = nil) async throws -> BuiltComposition {
        let composition = AVMutableComposition()
        var mixParameters: [AVMutableAudioMixInputParameters] = []
        var naturalSize = CGSize(width: 1920, height: 1080)

        // MARK: Video track (+ the clips' own sound)
        let videoClips = project.videoTrack.clips
        if !videoClips.isEmpty {
            guard let compVideo = composition.addMutableTrack(withMediaType: .video,
                                                              preferredTrackID: kCMPersistentTrackID_Invalid),
                  let compOriginalAudio = composition.addMutableTrack(withMediaType: .audio,
                                                                      preferredTrackID: kCMPersistentTrackID_Invalid)
            else { throw CompositionError.cannotCreateTrack }

            let originalAudioParams = AVMutableAudioMixInputParameters(track: compOriginalAudio)
            var didSetTransform = false

            for clip in videoClips {
                let asset = AVURLAsset(url: clip.sourceURL, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
                guard let sourceVideo = try await asset.loadTracks(withMediaType: .video).first else {
                    throw CompositionError.noVideoTrack(clip.sourceURL)
                }
                let wanted = CMTimeRange(start: clip.sourceStart.cmTime, duration: clip.duration.cmTime)
                let insertAt = clip.timelineStart.cmTime

                let videoRange = wanted.intersection(try await sourceVideo.load(.timeRange))
                if !videoRange.isEmpty {
                    try compVideo.insertTimeRange(videoRange, of: sourceVideo, at: insertAt)
                }

                if !didSetTransform {
                    let (size, transform) = try await sourceVideo.load(.naturalSize, .preferredTransform)
                    // NOTE: one transform for the whole track. Mixing portrait and landscape clips
                    // needs per-clip layer instructions (see README "Still to build").
                    compVideo.preferredTransform = transform
                    let upright = CGRect(origin: .zero, size: size).applying(transform)
                    naturalSize = CGSize(width: abs(upright.width), height: abs(upright.height))
                    didSetTransform = true
                }

                if let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first {
                    let audioRange = wanted.intersection(try await sourceAudio.load(.timeRange))
                    if !audioRange.isEmpty {
                        try compOriginalAudio.insertTimeRange(audioRange, of: sourceAudio, at: insertAt)
                        originalAudioParams.setVolume(clip.volume, at: insertAt)
                    }
                }
            }

            if compOriginalAudio.segments.isEmpty {
                composition.removeTrack(compOriginalAudio)
            } else {
                mixParameters.append(originalAudioParams)
            }
        }

        // MARK: Audio (music) track — each clip gets its own composition track so clips may overlap.
        for clip in project.audioTrack.clips {
            let asset = AVURLAsset(url: clip.sourceURL)
            guard let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first,
                  let compAudio = composition.addMutableTrack(withMediaType: .audio,
                                                              preferredTrackID: kCMPersistentTrackID_Invalid)
            else { continue }

            let wanted = CMTimeRange(start: clip.sourceStart.cmTime, duration: clip.duration.cmTime)
            let range = wanted.intersection(try await sourceAudio.load(.timeRange))
            guard !range.isEmpty else { composition.removeTrack(compAudio); continue }
            let insertAt = clip.timelineStart.cmTime
            try compAudio.insertTimeRange(range, of: sourceAudio, at: insertAt)

            let params = AVMutableAudioMixInputParameters(track: compAudio)
            params.setVolume(clip.volume, at: .zero)
            // Short fade-out so music never ends with a click.
            let fade = min(musicFadeOut, clip.duration / 2)
            let fadeRange = CMTimeRange(start: (clip.timelineEnd - fade).cmTime, duration: fade.cmTime)
            params.setVolumeRamp(fromStartVolume: clip.volume, toEndVolume: 0, timeRange: fadeRange)
            mixParameters.append(params)
        }

        // MARK: Lighting (Core Image) video composition
        var videoComposition: AVMutableVideoComposition?
        if !videoClips.isEmpty {
            var renderSize = naturalSize
            if let maxWidth = maxPreviewWidth, renderSize.width > maxWidth {
                // Preview renders at reduced size to keep scrubbing light.
                let scale = maxWidth / renderSize.width
                renderSize = CGSize(width: (renderSize.width * scale).rounded(), height: (renderSize.height * scale).rounded())
            }
            videoComposition = try await makeVideoComposition(for: composition,
                                                              adjustments: project.adjustments,
                                                              renderSize: renderSize)
        }

        var audioMix: AVMutableAudioMix?
        if !mixParameters.isEmpty {
            let mix = AVMutableAudioMix()
            mix.inputParameters = mixParameters
            audioMix = mix
        }

        return BuiltComposition(composition: composition,
                                videoComposition: videoComposition,
                                audioMix: audioMix,
                                naturalRenderSize: naturalSize)
    }

    /// Builds only the Core Image video composition. Used on its own when just the sliders change,
    /// so the player does not have to rebuild the whole composition.
    static func makeVideoComposition(for asset: AVAsset,
                                     adjustments: Adjustments,
                                     renderSize: CGSize,
                                     frameRate: Int32 = 30) async throws -> AVMutableVideoComposition {
        let videoComposition = try await AVMutableVideoComposition.videoComposition(
            with: asset,
            applyingCIFiltersWithHandler: { request in
                let output = CompositionBuilder.render(request.sourceImage,
                                                       adjustments: adjustments,
                                                       renderSize: request.renderSize)
                request.finish(with: output, context: nil)
            })
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: frameRate)
        return videoComposition
    }

    /// Applies exposure / brightness / contrast / saturation, then fits the frame into `renderSize`
    /// (letterboxed on black) so export presets can rescale the output.
    static func render(_ source: CIImage, adjustments: Adjustments, renderSize: CGSize) -> CIImage {
        let extent = source.extent
        var image = source

        if adjustments.exposure != 0 {
            let exposure = CIFilter.exposureAdjust()
            exposure.inputImage = image
            exposure.ev = Float(adjustments.exposure)
            image = exposure.outputImage ?? image
        }
        if adjustments.brightness != 0 || adjustments.contrast != 1 || adjustments.saturation != 1 {
            let color = CIFilter.colorControls()
            color.inputImage = image
            color.brightness = Float(adjustments.brightness)
            color.contrast = Float(adjustments.contrast)
            color.saturation = Float(adjustments.saturation)
            image = color.outputImage ?? image
        }
        image = image.cropped(to: extent)

        guard extent.width > 0, extent.height > 0, renderSize.width > 0, renderSize.height > 0 else { return image }

        let scale = min(renderSize.width / extent.width, renderSize.height / extent.height)
        let scaledWidth = extent.width * scale
        let scaledHeight = extent.height * scale
        let transform = CGAffineTransform(translationX: -extent.minX, y: -extent.minY)
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(CGAffineTransform(translationX: (renderSize.width - scaledWidth) / 2,
                                             y: (renderSize.height - scaledHeight) / 2))
        let frame = CGRect(origin: .zero, size: renderSize)
        let background = CIImage(color: CIColor.black).cropped(to: frame)
        return image.transformed(by: transform).composited(over: background).cropped(to: frame)
    }
}
