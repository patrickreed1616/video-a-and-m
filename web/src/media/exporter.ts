import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import { type Clip, type Project, clipEnd, projectDuration } from '../model/types';
import { SAMPLE_RATE, chunkAudio, mixProjectAudio } from './audioMix';
import { GLFilterRenderer } from './glFilter';
import { getMedia } from './registry';

/**
 * YouTube-oriented presets. Bitrates follow YouTube's recommended upload settings for SDR
 * (720p 5 Mbps, 1080p 8 Mbps @24-30 / 12 Mbps @48-60, 4K 35-45 Mbps @24-30).
 * https://support.google.com/youtube/answer/1722171
 */
export interface ExportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  /** H.264 High profile at a level that fits the size/frame rate. */
  codecString: string;
}

export const AUDIO_BITRATE = 384_000;

export const PRESETS: ExportPreset[] = [
  { id: '720p30', label: '720p · 30 fps', width: 1280, height: 720, fps: 30, videoBitrate: 5_000_000, codecString: 'avc1.64001f' },
  { id: '1080p30', label: '1080p · 30 fps (recommended)', width: 1920, height: 1080, fps: 30, videoBitrate: 10_000_000, codecString: 'avc1.640028' },
  { id: '1080p60', label: '1080p · 60 fps', width: 1920, height: 1080, fps: 60, videoBitrate: 12_000_000, codecString: 'avc1.64002a' },
  { id: '2160p30', label: '4K · 30 fps', width: 3840, height: 2160, fps: 30, videoBitrate: 40_000_000, codecString: 'avc1.640033' },
];
export const DEFAULT_PRESET = PRESETS[1];

export function presetDetail(p: ExportPreset) {
  return `H.264 High · ${p.videoBitrate / 1e6} Mbps · ${p.fps} fps · AAC 48 kHz stereo 384 kbps · MP4`;
}

/** Portrait projects get the preset with width/height swapped (e.g. 1080×1920 for Shorts). */
export function outputSize(project: Project, p: ExportPreset): { width: number; height: number } {
  const first = project.videoClips[0] && getMedia(project.videoClips[0].sourceId);
  const portrait = !!first && first.height > first.width;
  return portrait ? { width: p.height, height: p.width } : { width: p.width, height: p.height };
}

export interface SupportReport {
  ok: boolean;
  webCodecs: boolean;
  /** Full codec string to use, or undefined to let the encoder pick (non-High profile). */
  codecString?: string;
  highProfile: boolean;
  nativeAac: boolean;
  message?: string;
}

/** Feature detection for one preset. */
export async function checkSupport(project: Project, preset: ExportPreset): Promise<SupportReport> {
  const webCodecs = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
  if (typeof VideoEncoder === 'undefined') {
    return {
      ok: false, webCodecs, highProfile: false, nativeAac: false,
      message: 'This browser has no WebCodecs video encoder, so it cannot export. Use a current Chrome or Edge (or Safari 26+).',
    };
  }
  const { width, height } = outputSize(project, preset);
  const quality = new Quality({ bitrate: preset.videoBitrate });
  let codecString: string | undefined = preset.codecString;
  let highProfile = await canEncodeVideo('avc', { width, height, quality, frameRate: preset.fps, fullCodecString: codecString }).catch(() => false);
  if (!highProfile) {
    codecString = undefined;
    const anyAvc = await canEncodeVideo('avc', { width, height, quality, frameRate: preset.fps }).catch(() => false);
    if (!anyAvc) {
      return {
        ok: false, webCodecs, highProfile: false, nativeAac: false,
        message: `This browser can't encode H.264 at ${width}×${height}. Try a smaller preset, or use Chrome or Edge.`,
      };
    }
  }
  const nativeAac = typeof AudioEncoder !== 'undefined'
    && (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: new Quality({ bitrate: AUDIO_BITRATE }) }).catch(() => false));
  return {
    ok: true, webCodecs, codecString, highProfile, nativeAac,
    message: highProfile ? undefined : 'H.264 High profile is not available here, so the encoder will pick a compatible profile.',
  };
}

let aacFallbackRegistered = false;
async function ensureAac(native: boolean) {
  if (native || aacFallbackRegistered) return;
  // Lazy-loaded WASM AAC-LC encoder (FFmpeg-based) for browsers without native AAC encoding.
  const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
  registerAacEncoder();
  aacFallbackRegistered = true;
}

export interface ExportOptions {
  project: Project;
  preset: ExportPreset;
  /** From showSaveFilePicker; when absent the file is built in memory and downloaded. */
  fileHandle?: FileSystemFileHandle;
  signal: AbortSignal;
  onProgress: (fraction: number, stage: string) => void;
}

/** Renders the timeline to a YouTube-ready MP4 entirely in the browser. Returns a Blob when no file handle was used. */
export async function exportProject(opts: ExportOptions): Promise<Blob | null> {
  const { project, preset, signal, onProgress } = opts;
  if (!project.videoClips.length) throw new Error('Add a video clip before exporting.');

  const support = await checkSupport(project, preset);
  if (!support.ok) throw new Error(support.message);
  await ensureAac(support.nativeAac);

  const { width, height } = outputSize(project, preset);
  const fps = preset.fps;
  const duration = projectDuration(project);
  const frameCount = Math.max(1, Math.ceil(duration * fps));

  onProgress(0, 'Mixing audio…');
  const mixed = await mixProjectAudio(project, signal);
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

  // Output: stream straight to disk when we have a handle, otherwise keep in memory.
  const writable = opts.fileHandle ? await opts.fileHandle.createWritable() : null;
  const target = writable ? new StreamTarget(writable, { chunked: true }) : new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: writable ? 'reserve' : 'in-memory' }),
    target,
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new GLFilterRenderer(canvas, true);

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    quality: new Quality({ bitrate: preset.videoBitrate }),
    keyFrameInterval: 0.5, // YouTube: closed GOP of half the frame rate
    latencyMode: 'quality',
    ...(support.codecString ? { fullCodecString: support.codecString } : {}),
  });
  output.addVideoTrack(videoSource, { frameRate: fps, maximumPacketCount: Math.ceil(frameCount * 1.34) + 16 });

  let audioSource: AudioBufferSource | null = null;
  if (mixed) {
    audioSource = new AudioBufferSource({ codec: 'aac', quality: new Quality({ bitrate: AUDIO_BITRATE }) });
    output.addAudioTrack(audioSource, { maximumPacketCount: Math.ceil((mixed.length / 1024) * 1.34) + 16 });
  }

  const inputs: Input[] = [];
  const abort = async () => {
    await output.cancel().catch(() => {});
    if (writable) await writable.abort().catch(() => {});
  };

  try {
    await output.start();

    // Feed audio alongside video so the muxer can interleave (avoids backpressure deadlock).
    const audioDone = (async () => {
      if (!mixed || !audioSource) return;
      for (const piece of chunkAudio(mixed)) {
        if (signal.aborted) return;
        await audioSource.add(piece);
      }
      audioSource.close();
    })();

    const sinks = new Map<string, CanvasSink | null>();
    const sinkFor = async (clip: Clip) => {
      if (sinks.has(clip.sourceId)) return sinks.get(clip.sourceId)!;
      const m = getMedia(clip.sourceId);
      let sink: CanvasSink | null = null;
      if (m) {
        const input = new Input({ source: new BlobSource(m.file), formats: ALL_FORMATS });
        inputs.push(input);
        const track = await input.getPrimaryVideoTrack();
        if (track && (await track.canDecode())) sink = new CanvasSink(track, { width, height, fit: 'contain' });
      }
      sinks.set(clip.sourceId, sink);
      return sink;
    };

    let frame = 0;
    const frameDur = 1 / fps;
    const pushFrame = async () => {
      await videoSource.add(frame * frameDur, frameDur);
      frame++;
      if (frame % 5 === 0) onProgress(frame / frameCount, 'Encoding video…');
    };

    for (const clip of project.videoClips) {
      if (signal.aborted) break;
      const sink = await sinkFor(clip);
      const times: number[] = [];
      for (let f = frame; f < frameCount && f * frameDur < clipEnd(clip) - 1e-6; f++) {
        times.push(clip.sourceStart + (f * frameDur - clip.timelineStart));
      }
      if (!sink) {
        for (let i = 0; i < times.length && !signal.aborted; i++) { renderer.clear(); await pushFrame(); }
        continue;
      }
      for await (const wc of sink.canvasesAtTimestamps(times)) {
        if (signal.aborted) break;
        if (wc) renderer.draw(wc.canvas, project.adjustments);
        else renderer.clear();
        await pushFrame();
      }
    }
    // Music running past the last video clip: pad with black frames.
    while (frame < frameCount && !signal.aborted) {
      renderer.clear();
      await pushFrame();
    }

    if (signal.aborted) {
      await abort();
      throw new DOMException('Export cancelled', 'AbortError');
    }
    videoSource.close();
    await audioDone;
    onProgress(1, 'Finishing file…');
    await output.finalize();
    return writable ? null : new Blob([(target as BufferTarget).buffer!], { type: 'video/mp4' });
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await abort();
    throw err;
  } finally {
    inputs.forEach((i) => i.dispose());
  }
}
