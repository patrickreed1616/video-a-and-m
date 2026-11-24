# Video A&M

A local, native Mac video editing app built with SwiftUI and AVFoundation. No Adobe, no cloud processing.

## Features

- **Timeline tracks:** video track on top, audio track beneath it
- **Drag-and-drop import** of video files
- **Trim tools:** simple cutting and trimming of clips
- **Lighting adjustment:** basic brightness, contrast, and saturation controls
- **Royalty-free music library:** search and drop a track onto any section of the timeline
- **YouTube-optimized export:** MP4 (H.264 video, AAC audio) at YouTube's recommended resolution and bitrate

## Design

Minimal and clean: simple and effective, not feature-bloated. All processing runs locally with AVFoundation.

## Requirements

- macOS 14 or later
- Xcode 15 or later

## Web app (runs in the browser, installable)

The `web/` folder has a second version of Video A&M that runs entirely in the browser. You can install it like an
app from Chrome, Edge or Safari. It has the same features as the Mac app: preview, toolbar, a video track over an
audio track, drag-and-drop import, split, trim, delete with undo, lighting sliders, the music sidebar, and MP4 export
for YouTube. **Nothing is uploaded.** Files are read, edited and encoded on your own computer.

**Run it locally**

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # required-files check → type-check → production build in web/dist → check the build
npm run preview    # serve the built app (service worker and install work here too)
```

**Install it as an app**

* Chrome / Edge: click **Install** in the app's toolbar, or the install icon in the address bar.
* Safari on macOS 14+: **File → Add to Dock**.
* Once installed it opens in its own window and the app shell works offline. On Chrome and Edge you can also open
  `.mp4`, `.mov` and `.m4v` files with it from the OS.

**How it's built**

| Part | Choice | Why |
|---|---|---|
| App | Vite + TypeScript + Preact | Fast builds, strict types. Preact gives React-style components in ~4 kB |
| Preview | `<video>`/`<audio>` elements + WebGL shader | Hardware decoding for smooth playback. One shader handles exposure, brightness, contrast and saturation in both preview and export |
| Import / decode | [Mediabunny](https://mediabunny.dev) (`Input`, `CanvasSink`) | Reads MP4/MOV, and decodes exact frames with WebCodecs for export and thumbnails |
| Export | WebCodecs `VideoEncoder` + Mediabunny MP4 muxer | H.264 High profile (`avc1.64xxxx`), exact bitrate, keyframe every 0.5 s, fast-start MP4 |
| Audio | `OfflineAudioContext` mix → AAC-LC 48 kHz stereo 384 kbps | Uses native AAC when the browser has it, otherwise `@mediabunny/aac-encoder` (FFmpeg's AAC in WASM, loaded only when needed). No SharedArrayBuffer and no COOP/COEP headers needed |
| Saving | `showSaveFilePicker` (Chrome/Edge) streams straight to disk; other browsers get a download | Big exports never sit in memory when the File System Access API is there |
| Offline / install | `vite-plugin-pwa` (Workbox) + web manifest + icons in `web/public/icons` (made by `npm run icons`) | Installable app shell that works offline |

Export presets match the Mac app: 720p30 5 Mbps, **1080p30 10 Mbps (default)**, 1080p60 12 Mbps, 4K30 40 Mbps.
Portrait projects swap width and height.

**Music in the web app:** `web/public/music/catalog.json` has the same clearly labelled *example* entries and no
audio. They show as "No file yet". Click **Add audio** in the Music sidebar to add your own royalty-free files.
They're stored in the browser (IndexedDB) on that device only. To bundle real tracks, put the files in
`web/public/music/`, add matching catalog entries, and remove `"example": true`. A Freesound source stub
(`FreesoundSource` in `web/src/music/musicLibrary.ts`) implements the same `MusicSource` interface for later.

**Browser support**

| Browser | Editing & preview | Export |
|---|---|---|
| Chrome / Edge (desktop, current) | ✅ | ✅ H.264 High + AAC. Saves straight to disk |
| Safari 26+ (macOS) | ✅ | Should work (WebCodecs H.264). AAC uses the WASM encoder if needed. Downloads instead of the save dialog. **Not tested yet** |
| Safari 16.4–18 | ✅ | Likely: WebCodecs video is there and AAC goes through the WASM encoder. **Not tested yet** |
| Firefox (desktop, current) | ✅ | Works only if Firefox's WebCodecs can encode H.264 on that OS (AAC goes through WASM). Otherwise the export dialog says it can't. **Not tested yet** |

The export dialog checks what the browser supports and explains anything missing. If High profile isn't available,
it falls back to another H.264 profile. Exports take memory for long or 4K projects, because audio is mixed in one
pass and browsers without the save dialog build the file in memory.

**Web app: still to build:** save/open projects, reordering video clips by dragging, a clip volume slider and
waveforms, per-clip lighting, the Freesound source, an ffmpeg.wasm fallback for browsers without H.264 encoding,
and testing on Safari and Firefox.

---

## Mac app (SwiftUI)

> **Status (Mac app): scaffold, not yet compiled.** This was written on a Linux machine. Every file passes a
> Swift syntax parse and the model layer type-checks, but the AVFoundation/SwiftUI code has **never
> been built or run on a Mac**. Expect a few compiler fixes on the first build.

## Build on your Mac

Requirements: see above, plus Homebrew.

```bash
brew install xcodegen
git clone https://github.com/patrickreed1616/video-a-and-m.git
cd video-a-and-m
xcodegen                  # generates VideoAandM.xcodeproj from project.yml
open VideoAandM.xcodeproj
```

In Xcode choose the **VideoAandM** scheme, target **My Mac**, and press **⌘R**.
The app is signed ad-hoc ("Sign to Run Locally") and is not sandboxed, so no Apple developer account
is needed to run it on your own Mac.

Command-line build instead of Xcode:

```bash
xcodebuild -project VideoAandM.xcodeproj -scheme VideoAandM -configuration Debug build
```

## Names

* App name shown in Finder, the Dock, the menu bar and the window title: **Video A&M**
* Code, target, scheme and folder name: `VideoAandM` (Xcode identifiers can't contain `&`)
* Bundle ID: `com.patrickreed1616.videoaandm`
* User music folder: `~/Music/VideoAandM`

## Using it

| Action | How |
|---|---|
| Import video | Drag `.mov` / `.mp4` / `.m4v` files onto the window, or **Import** (⌘I) |
| Play / pause | Space |
| Scrub | Drag on the time ruler, or click an empty spot on a track |
| Split | Put the playhead on a clip → **Split** (⌘B). Splits the selected clip's track, or the video track |
| Trim | Drag a clip's left/right edge handle |
| Delete | Select a clip → **Delete** (⌫) |
| Move music | Drag a music clip along the audio track |
| Lighting | **Lighting** button → exposure, brightness, contrast, saturation (whole video) |
| Music | Search the sidebar, drag a track onto the audio row (or click **+** to drop it at the playhead) |
| Undo / Redo | ⌘Z / ⇧⌘Z |
| Export | **Export** (⌘E) → pick a preset → choose where to save |

The video track is magnetic: clips sit back to back, so trimming or deleting closes the gap.
The audio track is free-form: music clips go wherever you drop them and can overlap.
A clip's own sound plays along with it, and music gets a short fade-out at the end.

## Project layout

```
project.yml                      XcodeGen spec (macOS 14, Swift 5, ad-hoc signing, no sandbox)
VideoAandM/
  App/VideoAandMApp.swift           @main app, window, menu commands (undo/redo, import, export)
  Models/
    Clip.swift                   A clip: source file, in-point, trimmed duration, timeline position, volume
    Track.swift                  Video (magnetic) / audio (free) track
    Project.swift                The document: video track, audio track, lighting adjustments
    Adjustments.swift            Exposure / brightness / contrast / saturation values
    MusicTrack.swift             Library entry + catalog.json schema
  Services/
    CompositionBuilder.swift     Timeline → AVMutableComposition + Core Image video composition + audio mix
    ExportService.swift          YouTube presets; AVAssetReader → AVAssetWriter H.264/AAC MP4 with progress
    MusicLibrary.swift           MusicSource protocol, bundled catalog, ~/Music/VideoAandM folder, remote template
    ThumbnailGenerator.swift     Cached frame thumbnails for timeline clips (actor)
    MediaProbe.swift             Duration / track probing, time helpers
  ViewModels/EditorViewModel.swift  Project state, edits, undo, preview player, export state
  Views/
    EditorView.swift             Window layout, drag-and-drop import, file importer, alerts
    PlayerView.swift             AVPlayerView wrapper (no built-in controls)
    ToolbarView.swift            Import · play · time · split · delete · lighting · zoom · export
    TimelineView.swift           Ruler, rows, playhead, scrubbing
    TrackRowView.swift           One row; audio row accepts music drops
    ClipView.swift               Clip block, trim handles, move gesture, thumbnail strip
    AdjustmentsPanel.swift       Lighting sliders (popover)
    MusicLibraryView.swift       Searchable music sidebar with preview, drag and +
    ExportSheet.swift            Preset picker, save panel, progress, cancel
  Resources/Music/
    catalog.json                 EXAMPLE manifest only (placeholder entries, no audio shipped)
```

## Export settings (YouTube)

Export uses `AVAssetReader` → `AVAssetWriter` (not `AVAssetExportSession`) so the bitrate can be set exactly.

* Container: MP4 with the index at the front ("fast start"), which YouTube recommends
* Video: H.264 High profile (auto level), CABAC, B-frames on, keyframe every half second (closed GOP at half the frame rate)
* Audio: AAC-LC, 48 kHz, stereo, 384 kbps
* Lighting adjustments are baked in through the same Core Image filter used for preview

| Preset | Size | fps | Video bitrate |
|---|---|---|---|
| 720p | 1280×720 | 30 | 5 Mbps |
| 1080p (default) | 1920×1080 | 30 | 10 Mbps |
| 1080p60 | 1920×1080 | 60 | 12 Mbps |
| 4K | 3840×2160 | 30 | 40 Mbps |

These follow YouTube's recommended upload bitrates for standard-dynamic-range video (1080p: 8 Mbps at 24–30 fps, 12 Mbps at 48–60 fps; 4K: 35–45 Mbps at 24–30 fps). Check
<https://support.google.com/youtube/answer/1722171> in case they've changed. Portrait projects get the same presets
with width and height swapped (for example 1080×1920 for Shorts). Footage is scaled to fit and letterboxed on black.

## Music library

Video A&M does **not** come with any music. `Resources/Music/catalog.json` only has **example placeholder entries**,
which show up greyed out as "File missing". To add real music:

1. **Easiest:** click the folder icon in the Music sidebar. It opens `~/Music/VideoAandM`. Drop CC0 or royalty-free
   audio files (mp3/m4a/wav/aiff/caf) there and press refresh. No rebuild needed.
2. **Bundled with the app:** put the audio files in `VideoAandM/Resources/Music/`, and edit `catalog.json` so each entry's
   `file` matches the file name. Fill in the real title, artist, genre, duration, and license, delete the example
   entries, then rebuild. Audio files are git-ignored by default. Only commit them if the license allows redistribution.

Only use tracks whose license allows use in (monetized) YouTube videos, and add any credit the license requires to
your video description. CC0 (public domain) needs no credit. CC BY needs credit. Avoid NC (non-commercial) licenses if
your channel is monetized. Places to find tracks (check each track's license yourself):
YouTube Audio Library (in YouTube Studio), Pixabay Music (pixabay.com/music, Pixabay Content License),
Free Music Archive (freemusicarchive.org, varies per track), Freesound (freesound.org, filter by CC0).

### Plugging in a remote music source

`Services/MusicLibrary.swift` defines:

```swift
protocol MusicSource: Sendable {
    var name: String { get }
    func search(query: String) async throws -> [MusicTrack]
    func localFile(for track: MusicTrack) async throws -> URL   // download + cache for remote sources
}
```

`RemoteMusicSourceTemplate` is a stub to copy. Implement `search` with `URLSession`, have `localFile` download
into the caches folder, then add your source to `MusicLibrary(sources:)` in `VideoAandMApp.swift`. Store the API key
in the Keychain or an ignored `.xcconfig`, never in git. Things to know about the candidate providers, as of
late 2026 (double-check before building):

* **Pixabay:** the documented public API (`pixabay.com/api/docs`) covers **images and videos only**. It has no
  supported music endpoint. Scraping the website is fragile and probably against its terms, so don't.
* **Freesound** (`freesound.org/docs/api`): free API key. Text search can filter by license
  (`license:"Creative Commons 0"`). Search and previews work with the key, but downloading the original file
  needs OAuth2. It's mostly sound effects and loops, plus some music.
* **Free Music Archive:** its old public API was shut down. Don't count on an official API.
* **Jamendo** (`developer.jamendo.com`): free client ID with music search and streaming/download URLs.
  Tracks are under various Creative Commons licenses, often NC, so commercial use may need Jamendo Licensing.
  Filter carefully.

## Implemented vs. still to build

**Implemented (written, not yet compiled or run on a Mac)**

* Window layout: preview, toolbar, timeline, and music sidebar
* Drag-and-drop import onto the window, plus Import (⌘I). Dropped audio files go to the audio track
* Timeline with a ruler, magnetic video track, free audio track, thumbnail strips, playhead, scrubbing, and zoom
* Split at the playhead, trim by dragging edges, delete, move music clips, and undo/redo (100 steps)
* Lighting: exposure, brightness, contrast, and saturation through `CIExposureAdjust` and `CIColorControls` in an
  `AVVideoComposition` Core Image handler. Slider changes only swap the video composition (cheap), and preview
  renders at no more than 1920 px wide
* Music library: `MusicSource` protocol, bundled `catalog.json`, `~/Music/VideoAandM` folder source, search, preview
  playback, drag onto the audio row, and + to add at the playhead
* Mixing: each clip's own sound plus music, with per-clip volume in the model and a 0.5 s fade-out on music
* YouTube export: 4 presets, H.264 High and AAC 48 kHz/384 kbps, fast-start MP4, progress, cancel, Show in Finder

**Still to build / known gaps**

* **First compile on a Mac.** Expect small API or concurrency fixes, mainly in `ExportService`, `CompositionBuilder`,
  and drag-and-drop
* Saving and opening projects. `Project` is `Codable`, but there's no document or file handling yet
* Reordering video clips by dragging, and ripple or overwrite options
* Mixed orientation. The whole video track uses the first clip's rotation, so portrait and landscape clips in one
  timeline need per-clip layer instructions
* Clips with different frame rates or sizes are fitted to the output but never color- or frame-rate-converted
* No volume UI. The model and mixer support volume, but there's no slider or keyframes yet. No audio waveforms
  either
* Lighting applies to the whole video, not per clip. No color grading beyond the 4 sliders
* Remote music source (template only), and no license or attribution export for the video description
* Very long timelines at high zoom: the ruler draws one big canvas, which may need tiling
* No titles, transitions, or effects, on purpose, to keep it minimal
* No tests
