import SwiftUI
import UniformTypeIdentifiers

/// Main window: preview on top, toolbar, timeline below, music library on the right.
struct EditorView: View {
    @EnvironmentObject private var editor: EditorViewModel
    @EnvironmentObject private var music: MusicLibrary
    @State private var isDropTargeted = false

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                PlayerView(player: editor.player)
                    .frame(minHeight: 260)
                    .overlay {
                        if editor.project.videoTrack.clips.isEmpty { emptyState }
                    }
                Divider()
                ToolbarView()
                Divider()
                TimelineView()
                    .frame(height: 178)
            }
            .frame(minWidth: 680)

            MusicLibraryView()
                .frame(minWidth: 230, idealWidth: 270, maxWidth: 380)
        }
        // Drop .mov/.mp4/.m4v (or audio files) anywhere in the window.
        .dropDestination(for: URL.self) { urls, _ in
            let media = urls.filter { MediaProbe.isVideoFile($0) || MediaProbe.isAudioFile($0) }
            editor.importMedia(media)
            return !media.isEmpty
        } isTargeted: { isDropTargeted = $0 }
        .overlay {
            if isDropTargeted {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Color.accentColor, lineWidth: 3)
                    .padding(4)
                    .allowsHitTesting(false)
            }
        }
        .fileImporter(isPresented: $editor.showImporter,
                      allowedContentTypes: [.movie, .audio],
                      allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { editor.importMedia(urls) }
        }
        .sheet(isPresented: $editor.showExport) {
            ExportSheet()
                .environmentObject(editor)
        }
        .alert("Video A&M", isPresented: Binding(
            get: { editor.alertMessage != nil },
            set: { if !$0 { editor.alertMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(editor.alertMessage ?? "")
        }
        .task { await music.refresh() }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "film.stack")
                .font(.system(size: 40, weight: .light))
            Text("Drop video files here")
                .font(.title3)
            Text(".mov · .mp4 · .m4v")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Import…") { editor.showImporter = true }
        }
        .foregroundStyle(.white.opacity(0.85))
    }
}
