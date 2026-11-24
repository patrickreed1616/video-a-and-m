import Foundation

/// The whole editable document: one video track on top, one audio track below.
struct Project: Codable, Hashable {
    var name: String = "Untitled"
    var videoTrack = Track(kind: .video)
    var audioTrack = Track(kind: .audio)
    var adjustments = Adjustments()

    var duration: Double { max(videoTrack.duration, audioTrack.duration) }
    var isEmpty: Bool { videoTrack.clips.isEmpty && audioTrack.clips.isEmpty }

    func track(_ kind: Track.Kind) -> Track {
        kind == .video ? videoTrack : audioTrack
    }

    mutating func update(_ kind: Track.Kind, _ body: (inout Track) -> Void) {
        if kind == .video {
            body(&videoTrack)
            videoTrack.relayoutSequentially()
        } else {
            body(&audioTrack)
            audioTrack.sortByStart()
        }
    }

    func clip(withID id: Clip.ID) -> Clip? {
        videoTrack.clips.first { $0.id == id } ?? audioTrack.clips.first { $0.id == id }
    }
}
