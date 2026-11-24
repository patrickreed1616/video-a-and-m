import AVFoundation

/// YouTube-oriented export presets.
/// Bitrates follow YouTube's published "recommended upload encoding settings" for SDR uploads
/// (720p 5 Mbps, 1080p 8 Mbps @24–30fps / 12 Mbps @48–60fps, 4K 35–45 Mbps @24–30fps).
/// Re-check https://support.google.com/youtube/answer/1722171 if YouTube updates them.
struct ExportPreset: Identifiable, Hashable {
    let id: String
    let label: String
    let width: Int
    let height: Int
    let frameRate: Int32
    /// Average video bitrate in bits per second.
    let videoBitrate: Int

    static let audioBitrate = 384_000        // AAC-LC stereo, YouTube recommends 384 kbps
    static let audioSampleRate = 48_000.0    // 48 kHz (YouTube accepts 96 or 48 kHz)
    static let audioChannels = 2

    static let youtube720p30 = ExportPreset(id: "720p30", label: "720p · 30 fps", width: 1280, height: 720,
                                            frameRate: 30, videoBitrate: 5_000_000)
    static let youtube1080p30 = ExportPreset(id: "1080p30", label: "1080p · 30 fps (recommended)", width: 1920, height: 1080,
                                             frameRate: 30, videoBitrate: 10_000_000)
    static let youtube1080p60 = ExportPreset(id: "1080p60", label: "1080p · 60 fps", width: 1920, height: 1080,
                                             frameRate: 60, videoBitrate: 12_000_000)
    static let youtube4K30 = ExportPreset(id: "2160p30", label: "4K · 30 fps", width: 3840, height: 2160,
                                          frameRate: 30, videoBitrate: 40_000_000)

    static let all: [ExportPreset] = [youtube720p30, youtube1080p30, youtube1080p60, youtube4K30]

    var detail: String {
        "H.264 High · \(videoBitrate / 1_000_000) Mbps · \(frameRate) fps · AAC 48 kHz stereo 384 kbps · MP4 (fast start)"
    }

    /// Landscape presets are flipped for portrait projects (e.g. 1080×1920 for Shorts).
    func outputSize(forNaturalSize natural: CGSize) -> CGSize {
        natural.height > natural.width
            ? CGSize(width: height, height: width)
            : CGSize(width: width, height: height)
    }

    func videoSettings(size: CGSize) -> [String: Any] {
        [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(size.width),
            AVVideoHeightKey: Int(size.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: videoBitrate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
                AVVideoExpectedSourceFrameRateKey: Int(frameRate),
                // YouTube: closed GOP of half the frame rate.
                AVVideoMaxKeyFrameIntervalKey: max(1, Int(frameRate) / 2),
                AVVideoAllowFrameReorderingKey: true // B-frames (YouTube: 2 consecutive B-frames)
            ] as [String: Any]
        ]
    }

    static var audioSettings: [String: Any] {
        [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: audioSampleRate,
            AVNumberOfChannelsKey: audioChannels,
            AVEncoderBitRateKey: audioBitrate
        ]
    }

    /// Decoded PCM handed from the reader to the AAC encoder.
    static var pcmSettings: [String: Any] {
        [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: audioSampleRate,
            AVNumberOfChannelsKey: audioChannels,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]
    }
}

enum ExportError: LocalizedError {
    case nothingToExport
    case cannotAddOutput
    case cannotAddInput
    case readerFailed(Error?)
    case writerFailed(Error?)

    var errorDescription: String? {
        switch self {
        case .nothingToExport: return "Add a video clip before exporting."
        case .cannotAddOutput: return "Could not read the timeline for export."
        case .cannotAddInput: return "Could not configure the MP4 encoder."
        case .readerFailed(let error): return "Reading failed: \(error?.localizedDescription ?? "unknown error")"
        case .writerFailed(let error): return "Writing failed: \(error?.localizedDescription ?? "unknown error")"
        }
    }
}

/// Renders the timeline to an MP4 with AVAssetReader → AVAssetWriter so bitrate, profile,
/// GOP and audio settings can be set exactly (AVAssetExportSession presets cannot set bitrate).
final class ExportService {
    func export(project: Project,
                preset: ExportPreset,
                to url: URL,
                progress: @escaping @Sendable (Double) -> Void) async throws {
        guard !project.videoTrack.clips.isEmpty else { throw ExportError.nothingToExport }

        let built = try await CompositionBuilder.build(project: project)
        guard let videoComposition = built.videoComposition else { throw ExportError.nothingToExport }

        let outputSize = preset.outputSize(forNaturalSize: built.naturalRenderSize)
        videoComposition.renderSize = outputSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: preset.frameRate)

        let composition = built.composition
        let totalSeconds = max(composition.duration.seconds, 0.001)

        try? FileManager.default.removeItem(at: url)
        let reader = try AVAssetReader(asset: composition)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true // moov atom up front ("fast start")

        // Video: composition (with Core Image lighting) → H.264
        let videoTracks = try await composition.loadTracks(withMediaType: .video)
        let videoOutput = AVAssetReaderVideoCompositionOutput(
            videoTracks: videoTracks,
            videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        videoOutput.videoComposition = videoComposition
        videoOutput.alwaysCopiesSampleData = false
        guard reader.canAdd(videoOutput) else { throw ExportError.cannotAddOutput }
        reader.add(videoOutput)

        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: preset.videoSettings(size: outputSize))
        videoInput.expectsMediaDataInRealTime = false
        guard writer.canAdd(videoInput) else { throw ExportError.cannotAddInput }
        writer.add(videoInput)

        // Audio: mixed PCM (clip audio + music, with volumes/fades) → AAC
        var audioPair: (AVAssetReaderAudioMixOutput, AVAssetWriterInput)?
        let audioTracks = try await composition.loadTracks(withMediaType: .audio)
        if !audioTracks.isEmpty {
            let audioOutput = AVAssetReaderAudioMixOutput(audioTracks: audioTracks, audioSettings: ExportPreset.pcmSettings)
            audioOutput.audioMix = built.audioMix
            audioOutput.alwaysCopiesSampleData = false
            let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: ExportPreset.audioSettings)
            audioInput.expectsMediaDataInRealTime = false
            if reader.canAdd(audioOutput), writer.canAdd(audioInput) {
                reader.add(audioOutput)
                writer.add(audioInput)
                audioPair = (audioOutput, audioInput)
            }
        }

        guard writer.startWriting() else { throw ExportError.writerFailed(writer.error) }
        guard reader.startReading() else {
            writer.cancelWriting()
            throw ExportError.readerFailed(reader.error)
        }
        writer.startSession(atSourceTime: .zero)

        try await withTaskCancellationHandler {
            await withTaskGroup(of: Void.self) { group in
                group.addTask {
                    await Self.pump(output: videoOutput, input: videoInput, reader: reader,
                                    queueLabel: "VideoAandM.export.video") { seconds in
                        progress(min(max(seconds / totalSeconds, 0), 1))
                    }
                }
                if let pair = audioPair {
                    let (audioOutput, audioInput) = pair
                    group.addTask {
                        await Self.pump(output: audioOutput, input: audioInput, reader: reader,
                                        queueLabel: "VideoAandM.export.audio", onTime: nil)
                    }
                }
            }
            try Task.checkCancellation()
        } onCancel: {
            reader.cancelReading()
            writer.cancelWriting()
        }

        if reader.status == .failed {
            writer.cancelWriting()
            throw ExportError.readerFailed(reader.error)
        }

        await writer.finishWriting()
        guard writer.status == .completed else { throw ExportError.writerFailed(writer.error) }
        progress(1)
    }

    /// Mutable flag shared with the writer's callback queue.
    private final class Flag: @unchecked Sendable { var done = false }

    /// Moves samples from a reader output into a writer input until the source is exhausted.
    private static func pump(output: AVAssetReaderOutput,
                             input: AVAssetWriterInput,
                             reader: AVAssetReader,
                             queueLabel: String,
                             onTime: ((Double) -> Void)?) async {
        let queue = DispatchQueue(label: queueLabel)
        let flag = Flag()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            input.requestMediaDataWhenReady(on: queue) {
                guard !flag.done else { return }
                while input.isReadyForMoreMediaData {
                    if reader.status == .reading, let sample = output.copyNextSampleBuffer() {
                        onTime?(CMSampleBufferGetPresentationTimeStamp(sample).seconds)
                        if !input.append(sample) {
                            flag.done = true
                            input.markAsFinished()
                            continuation.resume()
                            return
                        }
                    } else {
                        flag.done = true
                        input.markAsFinished()
                        continuation.resume()
                        return
                    }
                }
            }
        }
    }
}
