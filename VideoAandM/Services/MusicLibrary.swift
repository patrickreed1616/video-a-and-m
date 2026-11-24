import AVFoundation
import Foundation

// MARK: - Source protocol

/// Anything that can list royalty-free music. Implement this to plug in a remote catalog later.
protocol MusicSource: Sendable {
    var name: String { get }
    /// Return tracks matching `query` (empty query = everything / a default page).
    func search(query: String) async throws -> [MusicTrack]
    /// Make sure the track's audio is on disk and return its local URL.
    /// Local sources just return `fileURL`; remote sources download and cache.
    func localFile(for track: MusicTrack) async throws -> URL
}

enum MusicSourceError: LocalizedError {
    case fileMissing(String)
    case notConfigured(String)

    var errorDescription: String? {
        switch self {
        case .fileMissing(let title): return "The audio file for “\(title)” is not in the library yet."
        case .notConfigured(let why): return why
        }
    }
}

private func matches(_ track: MusicTrack, _ query: String) -> Bool {
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    guard !q.isEmpty else { return true }
    return [track.title, track.artist, track.genre].contains { $0.lowercased().contains(q) }
}

// MARK: - Bundled catalog (Resources/Music/catalog.json)

/// Reads the manifest shipped inside the app bundle. Entries whose audio file is missing are still
/// listed (greyed out) so it is obvious which files still need to be added.
struct BundledMusicSource: MusicSource {
    let name = "Built-in"

    func search(query: String) async throws -> [MusicTrack] {
        guard let catalogURL = Bundle.main.url(forResource: "catalog", withExtension: "json", subdirectory: "Music") else {
            return []
        }
        let folder = catalogURL.deletingLastPathComponent()
        let catalog = try JSONDecoder().decode(MusicCatalog.self, from: Data(contentsOf: catalogURL))
        return catalog.tracks.map { entry in
            MusicTrack(id: "bundled:\(entry.id)",
                       title: entry.title,
                       artist: entry.artist,
                       genre: entry.genre,
                       duration: entry.duration,
                       license: entry.license,
                       sourceURL: entry.licenseURL.flatMap(URL.init(string:)),
                       fileURL: folder.appendingPathComponent(entry.file),
                       sourceName: name)
        }
        .filter { matches($0, query) }
    }

    func localFile(for track: MusicTrack) async throws -> URL {
        guard let url = track.fileURL, track.isAvailable else { throw MusicSourceError.fileMissing(track.title) }
        return url
    }
}

// MARK: - User folder (~/Music/VideoAandM)

/// Every audio file the user drops into ~/Music/VideoAandM shows up in the library.
/// Handy for CC0 / royalty-free downloads without rebuilding the app.
struct FolderMusicSource: MusicSource {
    let name = "My Music Folder"
    let folder: URL

    static var defaultFolder: URL {
        FileManager.default.urls(for: .musicDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VideoAandM", isDirectory: true)
    }

    init(folder: URL = FolderMusicSource.defaultFolder) {
        self.folder = folder
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    func search(query: String) async throws -> [MusicTrack] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        var tracks: [MusicTrack] = []
        for url in files where MediaProbe.isAudioFile(url) {
            let asset = AVURLAsset(url: url)
            let seconds = (try? await asset.load(.duration).seconds) ?? 0
            tracks.append(MusicTrack(id: "folder:\(url.lastPathComponent)",
                                     title: url.deletingPathExtension().lastPathComponent,
                                     artist: "Local file",
                                     genre: "",
                                     duration: seconds.isFinite ? seconds : 0,
                                     license: "Your file — confirm it is royalty-free",
                                     sourceURL: nil,
                                     fileURL: url,
                                     sourceName: name))
        }
        return tracks.filter { matches($0, query) }.sorted { $0.title < $1.title }
    }

    func localFile(for track: MusicTrack) async throws -> URL {
        guard let url = track.fileURL, track.isAvailable else { throw MusicSourceError.fileMissing(track.title) }
        return url
    }
}

// MARK: - Remote source template (not wired up)

/// Skeleton for an online catalog. NOT enabled by default — see README "Plugging in a remote music source".
/// Fill in `search` with the provider's API, map results to `MusicTrack` (fileURL = nil),
/// and implement `localFile` to download into `cacheFolder`. Only surface tracks whose license
/// allows use in monetised YouTube videos (e.g. filter Freesound by "Creative Commons 0").
struct RemoteMusicSourceTemplate: MusicSource {
    let name: String
    let apiKey: String?

    var cacheFolder: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VideoAandM/RemoteMusic", isDirectory: true)
    }

    func search(query: String) async throws -> [MusicTrack] {
        guard apiKey?.isEmpty == false else {
            throw MusicSourceError.notConfigured("\(name): no API key set.")
        }
        // TODO: call the provider's search endpoint with URLSession, decode, map to MusicTrack.
        return []
    }

    func localFile(for track: MusicTrack) async throws -> URL {
        // TODO: download the track's audio into cacheFolder (once) and return the file URL.
        throw MusicSourceError.notConfigured("\(name): downloading is not implemented yet.")
    }
}

// MARK: - Library (UI-facing)

@MainActor
final class MusicLibrary: ObservableObject {
    @Published var query: String = "" {
        didSet { scheduleSearch() }
    }
    @Published private(set) var tracks: [MusicTrack] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errors: [String] = []
    @Published private(set) var previewingID: MusicTrack.ID?

    private let sources: [any MusicSource]
    private var searchTask: Task<Void, Never>?
    private let previewPlayer = AVPlayer()

    init(sources: [any MusicSource] = [BundledMusicSource(), FolderMusicSource()]) {
        self.sources = sources
    }

    var userFolder: URL { FolderMusicSource.defaultFolder }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        var found: [MusicTrack] = []
        var problems: [String] = []
        let currentQuery = query
        for source in sources {
            do {
                found += try await source.search(query: currentQuery)
            } catch {
                problems.append("\(source.name): \(error.localizedDescription)")
            }
        }
        // Playable tracks first.
        tracks = found.sorted { ($0.isAvailable ? 0 : 1, $0.title) < ($1.isAvailable ? 0 : 1, $1.title) }
        errors = problems
    }

    func track(withID id: MusicTrack.ID) -> MusicTrack? {
        tracks.first { $0.id == id }
    }

    /// Resolves a track to a playable local file via the source that produced it.
    func localFile(for track: MusicTrack) async throws -> URL {
        guard let source = sources.first(where: { $0.name == track.sourceName }) else {
            throw MusicSourceError.fileMissing(track.title)
        }
        return try await source.localFile(for: track)
    }

    func togglePreview(_ track: MusicTrack) {
        if previewingID == track.id {
            previewPlayer.pause()
            previewingID = nil
            return
        }
        guard let url = track.fileURL, track.isAvailable else { return }
        previewPlayer.replaceCurrentItem(with: AVPlayerItem(url: url))
        previewPlayer.play()
        previewingID = track.id
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            await self?.refresh()
        }
    }
}
