import { store } from '../model/store';
import { type Clip, clipEnd, projectDuration } from '../model/types';
import { GLFilterRenderer } from './glFilter';
import { getMedia } from './registry';

const DRIFT = 0.25; // seconds of allowed drift between timeline clock and a media element
const PREVIEW_MAX_W = 1280;

/**
 * Plays the timeline with plain <video>/<audio> elements (hardware decoding, low CPU) and draws the
 * active video frame through the WebGL lighting filter on every animation frame.
 */
export class PreviewEngine {
  private renderer: GLFilterRenderer | null = null;
  private videos = new Map<string, HTMLVideoElement>(); // by sourceId
  private audios = new Map<string, HTMLAudioElement>(); // by clipId
  private activeVideo: HTMLVideoElement | null = null;
  private raf = 0;
  private clockStart = 0;
  private needsDraw = true;

  attach(canvas: HTMLCanvasElement) {
    this.renderer = new GLFilterRenderer(canvas);
    this.renderer.resize(1280, 720);
    this.renderer.clear();
    store.subscribe(() => {
      this.needsDraw = true;
      if (!store.get().playing) this.syncPaused();
    });
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  play() {
    const s = store.get();
    const dur = projectDuration(s.project);
    if (dur <= 0) return;
    if (s.playhead >= dur - 0.05) store.setPlayhead(0);
    this.clockStart = performance.now() - store.get().playhead * 1000;
    store.setPlaying(true);
  }

  pause() {
    store.setPlaying(false);
    this.videos.forEach((v) => v.pause());
    this.audios.forEach((a) => a.pause());
  }

  toggle() {
    if (store.get().playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const dur = projectDuration(store.get().project);
    store.setPlayhead(Math.min(Math.max(0, t), dur));
    if (store.get().playing) this.clockStart = performance.now() - store.get().playhead * 1000;
  }

  private videoFor(sourceId: string): HTMLVideoElement | null {
    let v = this.videos.get(sourceId);
    if (!v) {
      const m = getMedia(sourceId);
      if (!m) return null;
      v = document.createElement('video');
      v.src = m.url;
      v.preload = 'auto';
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      v.addEventListener('seeked', () => (this.needsDraw = true));
      v.addEventListener('loadeddata', () => (this.needsDraw = true));
      this.videos.set(sourceId, v);
    }
    return v;
  }

  private audioFor(clip: Clip): HTMLAudioElement | null {
    let a = this.audios.get(clip.id);
    if (!a) {
      const m = getMedia(clip.sourceId);
      if (!m) return null;
      a = new Audio(m.url);
      a.preload = 'auto';
      this.audios.set(clip.id, a);
    }
    return a;
  }

  private activeClip(t: number): Clip | undefined {
    return store.get().project.videoClips.find((c) => t >= c.timelineStart && t < clipEnd(c));
  }

  /** While paused: park the active element on the right frame. */
  private syncPaused() {
    const t = store.get().playhead;
    const clip = this.activeClip(t);
    if (!clip) return;
    const v = this.videoFor(clip.sourceId);
    if (!v) return;
    const want = clip.sourceStart + (t - clip.timelineStart);
    if (Math.abs(v.currentTime - want) > 1 / 60) v.currentTime = want;
    this.activeVideo = v;
  }

  private tick() {
    const r = this.renderer;
    if (!r) return;
    const s = store.get();
    const p = s.project;
    const dur = projectDuration(p);

    let t = s.playhead;
    if (s.playing) {
      t = (performance.now() - this.clockStart) / 1000;
      if (t >= dur) {
        this.pause();
        store.setPlayhead(dur);
        return;
      }
      store.setPlayhead(t);
    }

    // Preview canvas follows the first clip's aspect ratio.
    const first = p.videoClips[0] && getMedia(p.videoClips[0].sourceId);
    if (first && first.width && first.height) {
      const w = Math.min(PREVIEW_MAX_W, first.width);
      if (r.resize(Math.round(w), Math.round((w * first.height) / first.width))) this.needsDraw = true;
    }

    // ---- video
    const clip = this.activeClip(t);
    const v = clip ? this.videoFor(clip.sourceId) : null;
    if (s.playing) {
      for (const [, el] of this.videos) if (el !== v && !el.paused) el.pause();
      if (clip && v) {
        const want = clip.sourceStart + (t - clip.timelineStart);
        if (Math.abs(v.currentTime - want) > DRIFT) v.currentTime = want;
        v.volume = clip.volume;
        if (v.paused) v.play().catch(() => {});
      }
    }
    if (v !== this.activeVideo) this.needsDraw = true;
    this.activeVideo = v;

    if (s.playing || this.needsDraw) {
      if (v && v.readyState >= 2) r.draw(v, p.adjustments);
      else r.clear();
      this.needsDraw = false;
    }

    // ---- music
    const live = new Set<string>();
    for (const c of p.audioClips) {
      live.add(c.id);
      const a = this.audioFor(c);
      if (!a) continue;
      const inside = s.playing && t >= c.timelineStart && t < clipEnd(c);
      if (!inside) {
        if (!a.paused) a.pause();
        continue;
      }
      const want = c.sourceStart + (t - c.timelineStart);
      if (Math.abs(a.currentTime - want) > DRIFT) a.currentTime = want;
      const fadeLeft = clipEnd(c) - t;
      a.volume = Math.max(0, Math.min(1, c.volume * Math.min(1, fadeLeft / 0.5)));
      if (a.paused) a.play().catch(() => {});
    }
    for (const [id, a] of this.audios) {
      if (!live.has(id)) {
        a.pause();
        this.audios.delete(id);
      }
    }
  }
}

export const preview = new PreviewEngine();
