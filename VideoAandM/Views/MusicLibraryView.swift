import AppKit
import SwiftUI

/// Searchable royalty-free music list. Drag a row onto the audio track, or press + to drop it at the playhead.
struct MusicLibraryView: View {
    @EnvironmentObject private var music: MusicLibrary
    @EnvironmentObject private var editor: EditorViewModel
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Music").font(.headline)
                Spacer()
                Button { NSWorkspace.shared.open(music.userFolder) } label: {
                    Image(systemName: "folder")
                }
                .help("Open ~/Music/VideoAandM — drop royalty-free audio files there")
                Button { Task { await music.refresh() } } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("Rescan library")
            }
            .buttonStyle(.borderless)

            TextField("Search title, artist, genre", text: $music.query)
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                .onChange(of: searchFocused) { _, focused in editor.isTextEditing = focused }

            if music.tracks.isEmpty && !music.isLoading {
                ContentUnavailableView {
                    Label("No music yet", systemImage: "music.note.list")
                } description: {
                    Text("Add CC0 / royalty-free audio files to ~/Music/VideoAandM (folder button above), or bundle them in Resources/Music.")
                }
            } else {
                List(music.tracks) { track in
                    row(track)
                }
                .listStyle(.inset)
            }

            ForEach(music.errors, id: \.self) { message in
                Text(message).font(.caption2).foregroundStyle(.orange)
            }

            Text("Drag a track onto the audio row, or click + to add it at the playhead. Check each track’s license before publishing.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(10)
    }

    @ViewBuilder
    private func row(_ track: MusicTrack) -> some View {
        let content = MusicRow(track: track,
                               isPreviewing: music.previewingID == track.id,
                               onPreview: { music.togglePreview(track) },
                               onAdd: { editor.addMusic(track, at: editor.playhead, library: music) })
        if track.isAvailable {
            content.draggable(track.dragPayload) {
                Label(track.title, systemImage: "music.note")
                    .padding(6)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
            }
        } else {
            content
        }
    }
}

private struct MusicRow: View {
    let track: MusicTrack
    let isPreviewing: Bool
    let onPreview: () -> Void
    let onAdd: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onPreview) {
                Image(systemName: isPreviewing ? "stop.circle.fill" : "play.circle")
                    .font(.title3)
            }
            .buttonStyle(.borderless)
            .disabled(!track.isAvailable)

            VStack(alignment: .leading, spacing: 1) {
                Text(track.title).lineLimit(1)
                Text([track.artist, track.genre, track.duration > 0 ? track.duration.timecode : ""]
                        .filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(track.isAvailable ? track.license : "File missing — \(track.license)")
                    .font(.caption2)
                    .foregroundStyle(track.isAvailable ? Color.secondary : Color.orange)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button(action: onAdd) { Image(systemName: "plus.circle") }
                .buttonStyle(.borderless)
                .disabled(!track.isAvailable)
                .help("Add at playhead")
        }
        .opacity(track.isAvailable ? 1 : 0.55)
        .padding(.vertical, 2)
    }
}
