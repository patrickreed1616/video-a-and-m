import AVFoundation

/// Small helpers for reading basic facts about a media file.
enum MediaProbe {
    struct Info {
        var duration: Double
        var hasVideo: Bool
        var hasAudio: Bool
    }

    static let videoExtensions: Set<String> = ["mov", "mp4", "m4v"]
    static let audioExtensions: Set<String> = ["mp3", "m4a", "aac", "wav", "aif", "aiff", "caf"]

    static func isVideoFile(_ url: URL) -> Bool { videoExtensions.contains(url.pathExtension.lowercased()) }
    static func isAudioFile(_ url: URL) -> Bool { audioExtensions.contains(url.pathExtension.lowercased()) }

    static func info(for url: URL) async throws -> Info {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let duration = try await asset.load(.duration)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        return Info(duration: duration.seconds.isFinite ? duration.seconds : 0,
                    hasVideo: !videoTracks.isEmpty,
                    hasAudio: !audioTracks.isEmpty)
    }
}

extension Double {
    /// Seconds -> CMTime at a timescale fine enough for frame-accurate edits.
    var cmTime: CMTime { CMTime(seconds: self, preferredTimescale: 600) }
}

extension Double {
    /// "01:23.4" style label for the toolbar and ruler.
    var timecode: String {
        let total = max(0, self)
        let minutes = Int(total) / 60
        let seconds = total - Double(minutes * 60)
        return String(format: "%02d:%04.1f", minutes, seconds)
    }
}
