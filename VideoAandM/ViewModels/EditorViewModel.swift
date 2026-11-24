import AppKit
import AVFoundation
import Combine
import SwiftUI

/// Owns the project, the preview player, editing commands, undo and export state.
@MainActor
final class EditorViewModel: ObservableObject {
    enum TrimEdge { case leading, trailing }

    // MARK: Published state
    @Published var project = Project() {
        didSet { projectDidChange(from: oldValue) }
    }
    @Published var selectedClipID: Clip.ID?
    @Published private(set) var playhead: Double = 0
    @Published private(set) var isPlaying = false
    @Published var pixelsPerSecond: Double = 60
    @Published var showImporter = false
    @Published var showExport = false
    @Published var alertMessage: String?
    /// True while a text field (music search) has focus, so Space/Delete shortcuts stay out of its way.
    @Published var isTextEditing = false

    @Published private(set) var isExporting = false
    @Published private(set) var exportProgress: Double = 0
    @Published private(set) var exportError: String?
    @Published private(set) var lastExportURL: URL?

    let player = AVPlayer()

    // MARK: Private
    private var undoStack: [Project] = []
    private var redoStack: [Project] = []
    private var isRestoringHistory = false
    private var rebuildTask: Task<Void, Never>?
    private var pendingFullRebuild = false
    private var currentComposition: AVMutableComposition?
    private var previewRenderSize: CGSize = .zero
    private var timeObserver: Any?
    private var cancellables = Set<AnyCancellable>()
    private var exportTask: Task<Void, Never>?
    private let exportService = ExportService()

    static let previewMaxWidth: CGFloat = 1920

    init() {
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, self.isPlaying else { return }
                self.playhead = time.seconds
            }
        }
        player.publisher(for: \.timeControlStatus)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in self?.isPlaying = (status == .playing) }
            .store(in: &cancellables)
    }

    // MARK: Derived
    var selectedClip: Clip? { selectedClipID.flatMap { project.clip(withID: $0) } }
    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }

    // MARK: Import
    func importMedia(_ urls: [URL]) {
        let usable = urls.filter { MediaProbe.isVideoFile($0) || MediaProbe.isAudioFile($0) }
        guard !usable.isEmpty else { return }
        Task {
            var next = project
            var failures: [String] = []
            for url in usable {
                do {
                    let info = try await MediaProbe.info(for: url)
                    guard info.duration > Clip.minimumDuration else { continue }
                    if info.hasVideo {
                        let clip = Clip(kind: .video, sourceURL: url, title: url.deletingPathExtension().lastPathComponent,
                                        sourceDuration: info.duration, duration: info.duration)
                        next.update(.video) { $0.clips.append(clip) }
                    } else if info.hasAudio {
                        let clip = Clip(kind: .audio, sourceURL: url, title: url.deletingPathExtension().lastPathComponent,
                                        sourceDuration: info.duration, duration: info.duration, timelineStart: playhead)
                        next.update(.audio) { $0.clips.append(clip) }
                    }
                } catch {
                    failures.append("\(url.lastPathComponent): \(error.localizedDescription)")
                }
            }
            if next != project {
                registerUndo()
                if project.isEmpty, let first = next.videoTrack.clips.first {
                    next.name = first.title
                }
                project = next
            }
            if !failures.isEmpty { alertMessage = "Couldn’t import:\n" + failures.joined(separator: "\n") }
        }
    }

    /// Drops a library track onto the audio row at `time`.
    func addMusic(_ track: MusicTrack, at time: Double, library: MusicLibrary) {
        Task {
            do {
                let url = try await library.localFile(for: track)
                let info = try await MediaProbe.info(for: url)
                let length = info.duration > 0 ? info.duration : track.duration
                let clip = Clip(kind: .audio, sourceURL: url, title: track.title,
                                sourceDuration: length, duration: length,
                                timelineStart: max(0, time), volume: 0.8)
                registerUndo()
                project.update(.audio) { $0.clips.append(clip) }
                selectedClipID = clip.id
            } catch {
                alertMessage = error.localizedDescription
            }
        }
    }

    // MARK: Editing
    /// Call once at the start of a continuous edit (drag, slider) so it undoes as one step.
    func beginEdit() { registerUndo() }

    func splitAtPlayhead() {
        let time = playhead
        let kind: Track.Kind = selectedClip.map { $0.kind == .video ? .video : .audio } ?? .video
        guard let clip = project.track(kind).clips.first(where: { $0.contains(time: time) }) else {
            NSSound.beep()
            return
        }
        let offset = time - clip.timelineStart
        guard offset >= Clip.minimumDuration, clip.duration - offset >= Clip.minimumDuration else {
            NSSound.beep()
            return
        }
        var left = clip
        left.duration = offset
        var right = clip
        right.id = UUID()
        right.sourceStart += offset
        right.duration -= offset
        right.timelineStart = time

        registerUndo()
        project.update(kind) { track in
            guard let index = track.clips.firstIndex(where: { $0.id == clip.id }) else { return }
            track.clips[index] = left
            track.clips.insert(right, at: index + 1)
        }
        selectedClipID = right.id
    }

    func deleteSelected() {
        guard let id = selectedClipID, let clip = project.clip(withID: id) else { return }
        registerUndo()
        project.update(clip.kind == .video ? .video : .audio) { $0.clips.removeAll { $0.id == id } }
        selectedClipID = nil
    }

    /// Trims relative to the clip as it was when the drag began (`origin`), so the edit never drifts.
    func trim(clipID: Clip.ID, edge: TrimEdge, origin: Clip, deltaSeconds: Double) {
        let kind: Track.Kind = origin.kind == .video ? .video : .audio
        project.update(kind) { track in
            guard let index = track.clips.firstIndex(where: { $0.id == clipID }) else { return }
            var clip = track.clips[index]
            switch edge {
            case .leading:
                var lower = -origin.sourceStart
                if kind == .audio { lower = max(lower, -origin.timelineStart) }
                let d = min(max(deltaSeconds, lower), origin.duration - Clip.minimumDuration)
                clip.sourceStart = origin.sourceStart + d
                clip.duration = origin.duration - d
                clip.timelineStart = origin.timelineStart + d // video track is re-packed anyway
            case .trailing:
                let d = min(max(deltaSeconds, Clip.minimumDuration - origin.duration),
                            origin.sourceDuration - origin.sourceEnd)
                clip.duration = origin.duration + d
            }
            track.clips[index] = clip
        }
    }

    /// Slides a music clip along the audio track.
    func move(clipID: Clip.ID, origin: Clip, deltaSeconds: Double) {
        guard origin.kind == .audio else { return }
        project.update(.audio) { track in
            guard let index = track.clips.firstIndex(where: { $0.id == clipID }) else { return }
            track.clips[index].timelineStart = max(0, origin.timelineStart + deltaSeconds)
        }
    }

    func setVolume(_ volume: Float, for clipID: Clip.ID) {
        guard let clip = project.clip(withID: clipID) else { return }
        project.update(clip.kind == .video ? .video : .audio) { track in
            if let index = track.clips.firstIndex(where: { $0.id == clipID }) { track.clips[index].volume = volume }
        }
    }

    // MARK: Undo / redo
    private func registerUndo() {
        undoStack.append(project)
        if undoStack.count > 100 { undoStack.removeFirst() }
        redoStack.removeAll()
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(project)
        project = previous
        validateSelection()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(project)
        project = next
        validateSelection()
    }

    private func validateSelection() {
        if let id = selectedClipID, project.clip(withID: id) == nil { selectedClipID = nil }
    }

    // MARK: Transport
    func togglePlay() {
        if isPlaying {
            player.pause()
        } else {
            if playhead >= project.duration - 0.05 { seek(to: 0) }
            player.play()
        }
    }

    func seek(to seconds: Double) {
        let clamped = min(max(0, seconds), max(project.duration, 0))
        playhead = clamped
        player.seek(to: clamped.cmTime, toleranceBefore: .zero, toleranceAfter: .zero)
    }

    // MARK: Preview rebuilding
    private func projectDidChange(from old: Project) {
        guard project != old else { return }
        var withOldAdjustments = project
        withOldAdjustments.adjustments = old.adjustments
        let adjustmentsOnly = (withOldAdjustments == old) && currentComposition != nil
        scheduleRebuild(full: !adjustmentsOnly)
    }

    private func scheduleRebuild(full: Bool) {
        pendingFullRebuild = pendingFullRebuild || full
        rebuildTask?.cancel()
        rebuildTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(full ? 150 : 30))
            guard !Task.isCancelled, let self else { return }
            let doFull = self.pendingFullRebuild
            self.pendingFullRebuild = false
            if doFull {
                await self.rebuildPlayerItem()
            } else {
                await self.refreshAdjustments()
            }
        }
    }

    private func rebuildPlayerItem() async {
        let snapshot = project
        guard !snapshot.isEmpty else {
            player.replaceCurrentItem(with: nil)
            currentComposition = nil
            seek(to: 0)
            return
        }
        do {
            let built = try await CompositionBuilder.build(project: snapshot, maxPreviewWidth: Self.previewMaxWidth)
            guard snapshot == project else { return } // a newer edit will rebuild
            let item = AVPlayerItem(asset: built.composition)
            item.videoComposition = built.videoComposition
            item.audioMix = built.audioMix
            let wasPlaying = isPlaying
            let resumeAt = min(playhead, snapshot.duration)
            player.replaceCurrentItem(with: item)
            currentComposition = built.composition
            previewRenderSize = built.videoComposition?.renderSize ?? .zero
            _ = await player.seek(to: resumeAt.cmTime, toleranceBefore: .zero, toleranceAfter: .zero)
            if wasPlaying { player.play() }
        } catch {
            alertMessage = "Preview failed: \(error.localizedDescription)"
        }
    }

    /// Slider changes only swap the Core Image video composition — no composition rebuild.
    private func refreshAdjustments() async {
        guard let composition = currentComposition, let item = player.currentItem,
              !project.videoTrack.clips.isEmpty else { return }
        do {
            let videoComposition = try await CompositionBuilder.makeVideoComposition(
                for: composition, adjustments: project.adjustments, renderSize: previewRenderSize)
            item.videoComposition = videoComposition
        } catch {
            await rebuildPlayerItem()
        }
    }

    // MARK: Export
    func export(preset: ExportPreset, to url: URL) {
        guard !isExporting else { return }
        player.pause()
        exportError = nil
        lastExportURL = nil
        exportProgress = 0
        isExporting = true
        let snapshot = project
        exportTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.exportService.export(project: snapshot, preset: preset, to: url) { value in
                    Task { @MainActor [weak self] in
                        guard let self, self.isExporting else { return }
                        self.exportProgress = value
                    }
                }
                self.lastExportURL = url
            } catch is CancellationError {
                try? FileManager.default.removeItem(at: url)
            } catch {
                if Task.isCancelled {
                    try? FileManager.default.removeItem(at: url)
                } else {
                    self.exportError = error.localizedDescription
                }
            }
            self.isExporting = false
        }
    }

    func cancelExport() {
        exportTask?.cancel()
    }
}
