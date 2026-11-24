import SwiftUI

/// A clip block: thumbnails (video) or a tinted bar (audio), with trim handles on both edges.
/// Click to select; drag an edge to trim; drag a music clip's body to move it.
struct ClipView: View {
    let clip: Clip
    @EnvironmentObject private var editor: EditorViewModel
    @State private var dragOrigin: Clip?

    private var isSelected: Bool { editor.selectedClipID == clip.id }
    private var pps: Double { editor.pixelsPerSecond }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if clip.kind == .video {
                ThumbnailStrip(clip: clip)
            } else {
                LinearGradient(colors: [Color.teal.opacity(0.9), Color.teal.opacity(0.6)],
                               startPoint: .top, endPoint: .bottom)
                Image(systemName: "waveform")
                    .font(.system(size: 22))
                    .foregroundStyle(.white.opacity(0.25))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Text(clip.title)
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(.white)
                .shadow(radius: 2)
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .strokeBorder(isSelected ? Color.yellow : Color.white.opacity(0.25), lineWidth: isSelected ? 2 : 1)
        )
        .overlay(alignment: .leading) { trimHandle(.leading) }
        .overlay(alignment: .trailing) { trimHandle(.trailing) }
        .contentShape(Rectangle())
        .onTapGesture { editor.selectedClipID = clip.id }
        .gesture(moveGesture, including: clip.kind == .audio ? .all : .subviews)
        .help("\(clip.title) — \(clip.duration.timecode)")
    }

    private func trimHandle(_ edge: EditorViewModel.TrimEdge) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(Color.white.opacity(isSelected ? 0.9 : 0.35))
            .frame(width: 6)
            .padding(.vertical, 6)
            .padding(.horizontal, 1)
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .named(TimelineLayout.coordinateSpace))
                    .onChanged { value in
                        if dragOrigin == nil {
                            dragOrigin = clip
                            editor.selectedClipID = clip.id
                            editor.beginEdit()
                        }
                        guard let origin = dragOrigin else { return }
                        editor.trim(clipID: clip.id, edge: edge, origin: origin,
                                    deltaSeconds: Double(value.translation.width) / pps)
                    }
                    .onEnded { _ in dragOrigin = nil }
            )
    }

    private var moveGesture: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .named(TimelineLayout.coordinateSpace))
            .onChanged { value in
                if dragOrigin == nil {
                    dragOrigin = clip
                    editor.selectedClipID = clip.id
                    editor.beginEdit()
                }
                guard let origin = dragOrigin else { return }
                editor.move(clipID: clip.id, origin: origin, deltaSeconds: Double(value.translation.width) / pps)
            }
            .onEnded { _ in dragOrigin = nil }
    }
}

/// A row of frames sampled across the clip's trimmed range.
struct ThumbnailStrip: View {
    let clip: Clip
    @State private var images: [CGImage] = []

    var body: some View {
        GeometryReader { geo in
            let count = max(1, min(20, Int(geo.size.width / 90) + 1))
            HStack(spacing: 0) {
                ForEach(Array(images.enumerated()), id: \.offset) { _, image in
                    Image(decorative: image, scale: 2)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geo.size.width / CGFloat(max(images.count, 1)), height: geo.size.height)
                        .clipped()
                }
            }
            .task(id: "\(clip.sourceURL.path)|\((clip.sourceStart * 2).rounded())|\((clip.duration * 2).rounded())|\(count)") {
                var loaded: [CGImage] = []
                for i in 0..<count {
                    let t = clip.sourceStart + clip.duration * (Double(i) + 0.5) / Double(count)
                    if let image = await ThumbnailGenerator.shared.thumbnail(for: clip.sourceURL, at: t) {
                        loaded.append(image)
                    }
                    if Task.isCancelled { return }
                }
                images = loaded
            }
        }
        .background(Color.indigo.opacity(0.7))
    }
}
