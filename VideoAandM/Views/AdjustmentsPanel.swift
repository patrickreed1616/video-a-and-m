import SwiftUI

/// Basic lighting controls, applied to the whole video (preview + export) via Core Image.
struct AdjustmentsPanel: View {
    @EnvironmentObject private var editor: EditorViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Lighting").font(.headline)
            row("Exposure", value: $editor.project.adjustments.exposure, range: -2...2, format: "%+.2f EV")
            row("Brightness", value: $editor.project.adjustments.brightness, range: -0.5...0.5, format: "%+.2f")
            row("Contrast", value: $editor.project.adjustments.contrast, range: 0.5...1.5, format: "%.2f")
            row("Saturation", value: $editor.project.adjustments.saturation, range: 0...2, format: "%.2f")
            HStack {
                Spacer()
                Button("Reset") {
                    editor.beginEdit()
                    editor.project.adjustments = .neutral
                }
                .disabled(editor.project.adjustments.isNeutral)
            }
        }
        .padding(16)
        .frame(width: 300)
    }

    private func row(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, format: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                Spacer()
                Text(String(format: format, value.wrappedValue))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Slider(value: value, in: range, onEditingChanged: { editing in
                if editing { editor.beginEdit() }
            })
        }
    }
}
