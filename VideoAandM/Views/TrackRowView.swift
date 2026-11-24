import SwiftUI

/// One timeline row. The video row packs clips back to back; the audio row accepts
/// music dragged from the library at the drop position.
struct TrackRowView: View {
    let kind: Track.Kind
    @EnvironmentObject private var editor: EditorViewModel
    @EnvironmentObject private var music: MusicLibrary
    @State private var isTargeted = false

    var body: some View {
        let pps = CGFloat(editor.pixelsPerSecond)
        let track = editor.project.track(kind)

        ZStack(alignment: .leading) {
            Rectangle()
                .fill(isTargeted ? Color.accentColor.opacity(0.15) : Color(nsColor: .controlBackgroundColor))
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { value in
                    editor.selectedClipID = nil
                    editor.seek(to: Double(value.location.x / pps))
                })

            if track.clips.isEmpty {
                Text(kind == .video ? "Drop video clips here" : "Drag music here from the library →")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 10)
                    .allowsHitTesting(false)
            }

            ForEach(track.clips) { clip in
                ClipView(clip: clip)
                    .frame(width: max(CGFloat(clip.duration) * pps, 6),
                           height: (kind == .video ? TimelineLayout.videoRowHeight : TimelineLayout.audioRowHeight) - 10)
                    .offset(x: CGFloat(clip.timelineStart) * pps)
            }
        }
        .dropDestination(for: String.self) { items, location in
            guard kind == .audio else { return false }
            var handled = false
            for item in items where item.hasPrefix(MusicTrack.dragPrefix) {
                let id = String(item.dropFirst(MusicTrack.dragPrefix.count))
                if let track = music.track(withID: id) {
                    editor.addMusic(track, at: Double(location.x / pps), library: music)
                    handled = true
                }
            }
            return handled
        } isTargeted: { targeted in
            isTargeted = kind == .audio && targeted
        }
    }
}
