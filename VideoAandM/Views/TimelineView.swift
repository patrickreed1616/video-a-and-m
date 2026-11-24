import SwiftUI

enum TimelineLayout {
    static let headerWidth: CGFloat = 76
    static let rulerHeight: CGFloat = 24
    static let videoRowHeight: CGFloat = 74
    static let audioRowHeight: CGFloat = 58
    static let coordinateSpace = "timeline"
}

/// Ruler + video row + audio row, horizontally scrollable, with a playhead you can scrub.
struct TimelineView: View {
    @EnvironmentObject private var editor: EditorViewModel

    var body: some View {
        let pps = CGFloat(editor.pixelsPerSecond)
        let contentWidth = max(CGFloat(editor.project.duration + 15) * pps, 800)
        let totalHeight = TimelineLayout.rulerHeight + TimelineLayout.videoRowHeight + TimelineLayout.audioRowHeight

        HStack(spacing: 0) {
            VStack(spacing: 0) {
                Color.clear.frame(height: TimelineLayout.rulerHeight)
                header("Video", systemImage: "film").frame(height: TimelineLayout.videoRowHeight)
                Divider()
                header("Audio", systemImage: "music.note").frame(height: TimelineLayout.audioRowHeight - 1)
            }
            .frame(width: TimelineLayout.headerWidth)
            .background(.bar)

            Divider()

            ScrollView(.horizontal, showsIndicators: true) {
                ZStack(alignment: .topLeading) {
                    VStack(spacing: 0) {
                        TimeRulerView(pixelsPerSecond: pps)
                            .frame(width: contentWidth, height: TimelineLayout.rulerHeight)
                            .contentShape(Rectangle())
                            .gesture(scrubGesture(pps: pps))
                        TrackRowView(kind: .video)
                            .frame(width: contentWidth, height: TimelineLayout.videoRowHeight)
                        Divider()
                        TrackRowView(kind: .audio)
                            .frame(width: contentWidth, height: TimelineLayout.audioRowHeight - 1)
                    }

                    PlayheadView(height: totalHeight)
                        .offset(x: CGFloat(editor.playhead) * pps - PlayheadView.handleWidth / 2)
                        .allowsHitTesting(false)
                }
                .frame(width: contentWidth, height: totalHeight, alignment: .topLeading)
                .coordinateSpace(name: TimelineLayout.coordinateSpace)
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor))
    }

    private func scrubGesture(pps: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(TimelineLayout.coordinateSpace))
            .onChanged { value in
                if editor.isPlaying { editor.togglePlay() }
                editor.seek(to: Double(value.location.x / pps))
            }
    }

    private func header(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Second ticks with adaptive labels.
struct TimeRulerView: View {
    let pixelsPerSecond: CGFloat

    var body: some View {
        Canvas { context, size in
            let labelEvery: Double = pixelsPerSecond >= 120 ? 1 : pixelsPerSecond >= 50 ? 2 : pixelsPerSecond >= 25 ? 5 : 10
            let tickEvery: Double = pixelsPerSecond >= 120 ? 0.5 : 1
            let seconds = Int(Double(size.width / pixelsPerSecond)) + 1
            var t = 0.0
            while t <= Double(seconds) {
                let x = CGFloat(t) * pixelsPerSecond
                let isMajor = t.truncatingRemainder(dividingBy: labelEvery) == 0
                var path = Path()
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x, y: size.height - (isMajor ? 9 : 4)))
                context.stroke(path, with: .color(.secondary.opacity(isMajor ? 0.8 : 0.4)), lineWidth: 1)
                if isMajor {
                    context.draw(Text(t.timecode).font(.system(size: 9, design: .monospaced)).foregroundColor(.secondary),
                                 at: CGPoint(x: x + 3, y: 7), anchor: .leading)
                }
                t += tickEvery
            }
        }
        .background(.bar)
    }
}

/// Red line with a small handle.
struct PlayheadView: View {
    static let handleWidth: CGFloat = 11
    let height: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "arrowtriangle.down.fill")
                .font(.system(size: 10))
                .frame(width: Self.handleWidth, height: 10)
            Rectangle()
                .frame(width: 1.5, height: max(0, height - 10))
        }
        .foregroundStyle(.red)
        .frame(width: Self.handleWidth)
    }
}
