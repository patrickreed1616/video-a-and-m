import SwiftUI

/// One slim row: import · transport · time · split/delete · lighting · zoom · export.
struct ToolbarView: View {
    @EnvironmentObject private var editor: EditorViewModel
    @State private var showAdjustments = false

    var body: some View {
        HStack(spacing: 12) {
            Button { editor.showImporter = true } label: {
                Label("Import", systemImage: "plus.rectangle.on.folder")
            }
            .help("Import video files (⌘I)")

            Divider().frame(height: 18)

            Button { editor.togglePlay() } label: {
                Image(systemName: editor.isPlaying ? "pause.fill" : "play.fill")
                    .frame(width: 16)
            }
            .keyboardShortcut(editor.isTextEditing ? nil : KeyboardShortcut(.space, modifiers: []))
            .help("Play / Pause (Space)")
            .disabled(editor.project.isEmpty)

            Text("\(editor.playhead.timecode) / \(editor.project.duration.timecode)")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(minWidth: 120, alignment: .leading)

            Divider().frame(height: 18)

            Button { editor.splitAtPlayhead() } label: {
                Label("Split", systemImage: "scissors")
            }
            .keyboardShortcut("b", modifiers: .command)
            .help("Split clip at playhead (⌘B)")
            .disabled(editor.project.isEmpty)

            Button { editor.deleteSelected() } label: {
                Label("Delete", systemImage: "trash")
            }
            .keyboardShortcut(editor.isTextEditing ? nil : KeyboardShortcut(.delete, modifiers: []))
            .help("Delete selected clip (⌫)")
            .disabled(editor.selectedClipID == nil)

            Button { showAdjustments.toggle() } label: {
                Label("Lighting", systemImage: "sun.max")
            }
            .help("Exposure, brightness, contrast, saturation")
            .popover(isPresented: $showAdjustments, arrowEdge: .bottom) {
                AdjustmentsPanel()
                    .environmentObject(editor)
            }

            Spacer()

            Image(systemName: "minus.magnifyingglass").foregroundStyle(.secondary)
            Slider(value: $editor.pixelsPerSecond, in: 10...300)
                .frame(width: 110)
                .help("Timeline zoom")
            Image(systemName: "plus.magnifyingglass").foregroundStyle(.secondary)

            Button { editor.showExport = true } label: {
                Label("Export", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.borderedProminent)
            .disabled(editor.project.videoTrack.clips.isEmpty)
        }
        .labelStyle(.titleAndIcon)
        .buttonStyle(.borderless)
        .controlSize(.regular)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}
