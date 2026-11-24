import Foundation

/// A row on the timeline. The video track is "magnetic" (clips sit back to back);
/// the audio track lets clips sit anywhere.
struct Track: Identifiable, Codable, Hashable {
    enum Kind: String, Codable {
        case video
        case audio
    }

    var id = UUID()
    var kind: Kind
    var clips: [Clip] = []

    var duration: Double { clips.map(\.timelineEnd).max() ?? 0 }

    /// Packs video clips back to back in array order.
    mutating func relayoutSequentially() {
        var cursor = 0.0
        for index in clips.indices {
            clips[index].timelineStart = cursor
            cursor += clips[index].duration
        }
    }

    /// Keeps free-positioned clips sorted by start time.
    mutating func sortByStart() {
        clips.sort { $0.timelineStart < $1.timelineStart }
    }
}
