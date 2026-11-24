/** All times are in seconds. */
export type ClipKind = 'video' | 'audio';

export interface Clip {
  id: string;
  kind: ClipKind;
  /** Key into the media registry (the imported File). */
  sourceId: string;
  title: string;
  /** Full length of the source file (upper bound for trimming). */
  sourceDuration: number;
  /** In-point inside the source. */
  sourceStart: number;
  /** Length of the used part of the source. */
  duration: number;
  /** Position on the timeline. Video clips are packed back to back; audio clips sit anywhere. */
  timelineStart: number;
  /** 0..1 */
  volume: number;
}

export interface Adjustments {
  /** EV stops, -2..2 */
  exposure: number;
  /** -0.5..0.5 */
  brightness: number;
  /** 0.5..1.5 */
  contrast: number;
  /** 0..2 */
  saturation: number;
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = { exposure: 0, brightness: 0, contrast: 1, saturation: 1 };

export interface Project {
  name: string;
  videoClips: Clip[];
  audioClips: Clip[];
  adjustments: Adjustments;
}

export const MIN_CLIP = 0.1;

export const clipEnd = (c: Clip) => c.timelineStart + c.duration;

export function projectDuration(p: Project): number {
  let d = 0;
  for (const c of p.videoClips) d = Math.max(d, clipEnd(c));
  for (const c of p.audioClips) d = Math.max(d, clipEnd(c));
  return d;
}

export function videoDuration(p: Project): number {
  return p.videoClips.reduce((d, c) => Math.max(d, clipEnd(c)), 0);
}

/** Video track is magnetic: clips sit back to back in array order. */
export function packVideo(clips: Clip[]): Clip[] {
  let t = 0;
  return clips.map((c) => {
    const next = { ...c, timelineStart: t };
    t += c.duration;
    return next;
  });
}

export const sortAudio = (clips: Clip[]) => [...clips].sort((a, b) => a.timelineStart - b.timelineStart);

export const uid = () =>
  (globalThis.crypto && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function timecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
}
