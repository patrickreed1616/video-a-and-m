import { type Project, clipEnd, projectDuration } from '../model/types';
import { getMedia } from './registry';

export const SAMPLE_RATE = 48_000;
const FADE = 0.5;

/**
 * Mixes the clips' own sound and the music clips into one 48 kHz stereo AudioBuffer using an
 * OfflineAudioContext (faster than real time, runs locally). Returns null when there is no audio.
 */
export async function mixProjectAudio(project: Project, signal?: AbortSignal): Promise<AudioBuffer | null> {
  const duration = projectDuration(project);
  if (duration <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const decoded = new Map<string, AudioBuffer | null>();

  const decode = async (sourceId: string) => {
    if (decoded.has(sourceId)) return decoded.get(sourceId)!;
    const m = getMedia(sourceId);
    let buf: AudioBuffer | null = null;
    if (m?.hasAudio) {
      try {
        buf = await ctx.decodeAudioData(await m.file.arrayBuffer());
      } catch {
        buf = null; // e.g. a codec the browser can't decode; the clip stays silent
      }
    }
    decoded.set(sourceId, buf);
    return buf;
  };

  let any = false;
  for (const clip of [...project.videoClips, ...project.audioClips]) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const buf = await decode(clip.sourceId);
    if (!buf || clip.sourceStart >= buf.duration) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(clip.volume, clip.timelineStart);
    if (clip.kind === 'audio') {
      const fade = Math.min(FADE, clip.duration / 2);
      gain.gain.setValueAtTime(clip.volume, clipEnd(clip) - fade);
      gain.gain.linearRampToValueAtTime(0, clipEnd(clip));
    }
    src.connect(gain).connect(ctx.destination);
    src.start(clip.timelineStart, clip.sourceStart, Math.min(clip.duration, buf.duration - clip.sourceStart));
    any = true;
  }
  if (!any) return null;
  return ctx.startRendering();
}

/** Splits a long AudioBuffer into ~2 s pieces so audio and video can be fed to the muxer side by side. */
export function* chunkAudio(buffer: AudioBuffer, seconds = 2): Generator<AudioBuffer> {
  const step = Math.floor(seconds * buffer.sampleRate);
  for (let start = 0; start < buffer.length; start += step) {
    const len = Math.min(step, buffer.length - start);
    const piece = new AudioBuffer({ length: len, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      piece.copyToChannel(buffer.getChannelData(ch).subarray(start, start + len), ch);
    }
    yield piece;
  }
}
