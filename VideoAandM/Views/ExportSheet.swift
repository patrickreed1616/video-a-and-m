import AppKit
import UniformTypeIdentifiers
import SwiftUI

/// Pick a YouTube preset, choose a destination, watch progress.
struct ExportSheet: View {
    @EnvironmentObject private var editor: EditorViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var presetID = ExportPreset.youtube1080p30.id

    private var preset: ExportPreset {
        ExportPreset.all.first { $0.id == presetID } ?? .youtube1080p30
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Export for YouTube").font(.title3.weight(.semibold))

            Picker("Quality", selection: $presetID) {
                ForEach(ExportPreset.all) { preset in
                    Text(preset.label).tag(preset.id)
                }
            }
            .pickerStyle(.radioGroup)
            .disabled(editor.isExporting)

            Text(preset.detail)
                .font(.caption)
                .foregroundStyle(.secondary)

            if editor.isExporting {
                ProgressView(value: editor.exportProgress) {
                    Text("Exporting… \(Int(editor.exportProgress * 100))%")
                }
            } else if let url = editor.lastExportURL {
                HStack {
                    Label("Saved \(url.lastPathComponent)", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Spacer()
                    Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
                }
            }
            if let error = editor.exportError {
                Text(error).font(.caption).foregroundStyle(.red)
            }

            HStack {
                Spacer()
                if editor.isExporting {
                    Button("Cancel Export", role: .cancel) { editor.cancelExport() }
                } else {
                    Button("Close") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                    Button("Export…") { chooseDestination() }
                        .keyboardShortcut(.defaultAction)
                        .disabled(editor.project.videoTrack.clips.isEmpty)
                }
            }
        }
        .padding(20)
        .frame(width: 440)
    }

    private func chooseDestination() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.mpeg4Movie]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = "\(editor.project.name) \(preset.id).mp4"
        if panel.runModal() == .OK, let url = panel.url {
            editor.export(preset: preset, to: url)
        }
    }
}
