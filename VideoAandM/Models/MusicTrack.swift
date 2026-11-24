import Foundation

/// One entry in the music library (bundled catalog, local folder, or a remote source).
struct MusicTrack: Identifiable, Codable, Hashable {
    var id: String
    var title: String
    var artist: String
    var genre: String
    /// Seconds. For catalog entries this is the declared length; it is re-read from the file when available.
    var duration: Double
    /// Human-readable license, e.g. "CC0 1.0" or "Pixabay Content License".
    var license: String
    /// Optional link to the license / source page for attribution.
    var sourceURL: URL?
    /// Resolved local file. nil means "listed but the audio file is not present yet".
    var fileURL: URL?
    /// Name of the source that provided this track ("Bundled", "My Music Folder", ...).
    var sourceName: String = ""

    var isAvailable: Bool {
        guard let fileURL else { return false }
        return FileManager.default.fileExists(atPath: fileURL.path)
    }

    /// Payload used when dragging a library row onto the audio track.
    var dragPayload: String { MusicTrack.dragPrefix + id }
    static let dragPrefix = "videoaandm-music:"
}

/// Shape of one entry in Resources/Music/catalog.json.
struct MusicCatalogEntry: Codable {
    var id: String
    var title: String
    var artist: String
    var genre: String
    var duration: Double
    var license: String
    var licenseURL: String?
    var file: String
    var example: Bool?
}

struct MusicCatalog: Codable {
    var note: String?
    var tracks: [MusicCatalogEntry]
}
