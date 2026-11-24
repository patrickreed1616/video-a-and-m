import Foundation

/// A single piece of media placed on a track.
/// All times are in seconds (Double) to keep the model simple and Codable;
/// they are converted to CMTime only when the AVComposition is built.
struct Clip: Identifiable, Codable, Hashable {
    enum Kind: String, Codable {
        case video
        case audio
    }

    var id = UUID()
    var kind: Kind
    var sourceURL: URL
    var title: String

    /// Full length of the source file (upper bound for trimming).
    var sourceDuration: Double
    /// In-point inside the source file.
    var sourceStart: Double = 0
    /// Length of the used portion of the source (after trimming).
    var duration: Double
    /// Where the clip begins on the timeline.
    var timelineStart: Double = 0
    /// 0...1 gain used by the audio mix.
    var volume: Float = 1.0

    var timelineEnd: Double { timelineStart + duration }
    var sourceEnd: Double { sourceStart + duration }

    func contains(time: Double) -> Bool {
        time > timelineStart && time < timelineEnd
    }

    static let minimumDuration: Double = 0.1
}
