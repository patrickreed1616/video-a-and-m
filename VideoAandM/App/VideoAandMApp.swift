import AppKit
import SwiftUI

@main
struct VideoAandMApp: App {
    @StateObject private var editor = EditorViewModel()
    @StateObject private var music = MusicLibrary()

    var body: some Scene {
        WindowGroup("Video A&M") {
            EditorView()
                .environmentObject(editor)
                .environmentObject(music)
                .frame(minWidth: 1000, minHeight: 640)
        }
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("About Video A&M") {
                    NSApplication.shared.orderFrontStandardAboutPanel(options: [
                        NSApplication.AboutPanelOptionKey.applicationName: "Video A&M"
                    ])
                }
            }
            CommandGroup(replacing: .undoRedo) {
                Button("Undo") { editor.undo() }
                    .keyboardShortcut("z", modifiers: .command)
                    .disabled(!editor.canUndo)
                Button("Redo") { editor.redo() }
                    .keyboardShortcut("z", modifiers: [.command, .shift])
                    .disabled(!editor.canRedo)
            }
            CommandGroup(after: .newItem) {
                Button("Import Media…") { editor.showImporter = true }
                    .keyboardShortcut("i", modifiers: .command)
                Button("Export for YouTube…") { editor.showExport = true }
                    .keyboardShortcut("e", modifiers: .command)
                    .disabled(editor.project.videoTrack.clips.isEmpty)
            }
        }
    }
}
