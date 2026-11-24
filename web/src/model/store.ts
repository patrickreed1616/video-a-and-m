import { useEffect, useState } from 'preact/hooks';
import {
  type Adjustments,
  type Clip,
  MIN_CLIP,
  NEUTRAL_ADJUSTMENTS,
  type Project,
  clipEnd,
  packVideo,
  sortAudio,
  uid,
} from './types';

export interface EditorState {
  project: Project;
  selectedClipId: string | null;
  playhead: number;
  playing: boolean;
  pixelsPerSecond: number;
  canUndo: boolean;
  canRedo: boolean;
}

type Listener = () => void;
export type TrimEdge = 'start' | 'end';

/** Tiny observable store with snapshot-based undo/redo. */
export class EditorStore {
  private state: EditorState = {
    project: { name: 'Untitled', videoClips: [], audioClips: [], adjustments: { ...NEUTRAL_ADJUSTMENTS } },
    selectedClipId: null,
    playhead: 0,
    playing: false,
    pixelsPerSecond: 60,
    canUndo: false,
    canRedo: false,
  };
  private listeners = new Set<Listener>();
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];

  get = () => this.state;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---- undo -------------------------------------------------------------
  /** Snapshot before an edit. Continuous gestures call this once at the start. */
  checkpoint() {
    this.undoStack.push(this.state.project);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.set({ canUndo: true, canRedo: false });
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.state.project);
    this.setProject(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.state.project);
    this.setProject(next);
  }

  private setProject(project: Project) {
    const sel = this.state.selectedClipId;
    const stillThere = sel && [...project.videoClips, ...project.audioClips].some((c) => c.id === sel);
    this.set({
      project,
      selectedClipId: stillThere ? sel : null,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  /** Mutates the project without a checkpoint (caller decides). */
  private edit(fn: (p: Project) => Project) {
    this.set({ project: fn(this.state.project) });
  }

  // ---- transport / view -------------------------------------------------
  setPlayhead(t: number) {
    this.set({ playhead: Math.max(0, t) });
  }
  setPlaying(playing: boolean) {
    if (playing !== this.state.playing) this.set({ playing });
  }
  setZoom(pps: number) {
    this.set({ pixelsPerSecond: Math.min(400, Math.max(8, pps)) });
  }
  select(id: string | null) {
    this.set({ selectedClipId: id });
  }

  findClip(id: string | null): Clip | undefined {
    if (!id) return undefined;
    const p = this.state.project;
    return p.videoClips.find((c) => c.id === id) ?? p.audioClips.find((c) => c.id === id);
  }

  // ---- edits --------------------------------------------------------------
  addClips(clips: Clip[], name?: string) {
    if (!clips.length) return;
    this.checkpoint();
    this.edit((p) => ({
      ...p,
      name: p.videoClips.length === 0 && name ? name : p.name,
      videoClips: packVideo([...p.videoClips, ...clips.filter((c) => c.kind === 'video')]),
      audioClips: sortAudio([...p.audioClips, ...clips.filter((c) => c.kind === 'audio')]),
    }));
  }

  splitAtPlayhead(): boolean {
    const t = this.state.playhead;
    const selected = this.findClip(this.state.selectedClipId);
    const kind = selected?.kind ?? 'video';
    const list = kind === 'video' ? this.state.project.videoClips : this.state.project.audioClips;
    const clip = list.find((c) => t > c.timelineStart + MIN_CLIP && t < clipEnd(c) - MIN_CLIP);
    if (!clip) return false;
    const offset = t - clip.timelineStart;
    const left: Clip = { ...clip, duration: offset };
    const right: Clip = { ...clip, id: uid(), sourceStart: clip.sourceStart + offset, duration: clip.duration - offset, timelineStart: t };
    this.checkpoint();
    this.edit((p) => {
      const replace = (cs: Clip[]) => cs.flatMap((c) => (c.id === clip.id ? [left, right] : [c]));
      return kind === 'video'
        ? { ...p, videoClips: packVideo(replace(p.videoClips)) }
        : { ...p, audioClips: sortAudio(replace(p.audioClips)) };
    });
    this.set({ selectedClipId: right.id });
    return true;
  }

  deleteSelected() {
    const id = this.state.selectedClipId;
    if (!id || !this.findClip(id)) return;
    this.checkpoint();
    this.edit((p) => ({
      ...p,
      videoClips: packVideo(p.videoClips.filter((c) => c.id !== id)),
      audioClips: p.audioClips.filter((c) => c.id !== id),
    }));
    this.set({ selectedClipId: null });
  }

  /** Trim relative to the clip as it was when the drag began, so edits never drift. */
  trim(origin: Clip, edge: TrimEdge, delta: number) {
    let next: Clip;
    if (edge === 'start') {
      let lower = -origin.sourceStart;
      if (origin.kind === 'audio') lower = Math.max(lower, -origin.timelineStart);
      const d = Math.min(Math.max(delta, lower), origin.duration - MIN_CLIP);
      next = { ...origin, sourceStart: origin.sourceStart + d, duration: origin.duration - d, timelineStart: origin.timelineStart + d };
    } else {
      const d = Math.min(Math.max(delta, MIN_CLIP - origin.duration), origin.sourceDuration - origin.sourceStart - origin.duration);
      next = { ...origin, duration: origin.duration + d };
    }
    this.replaceClip(next);
  }

  /** Slide a music clip along the audio track. */
  move(origin: Clip, delta: number) {
    if (origin.kind !== 'audio') return;
    this.replaceClip({ ...origin, timelineStart: Math.max(0, origin.timelineStart + delta) });
  }

  setClipVolume(id: string, volume: number) {
    const c = this.findClip(id);
    if (c) this.replaceClip({ ...c, volume });
  }

  private replaceClip(next: Clip) {
    this.edit((p) =>
      next.kind === 'video'
        ? { ...p, videoClips: packVideo(p.videoClips.map((c) => (c.id === next.id ? { ...next, timelineStart: c.timelineStart } : c))) }
        : { ...p, audioClips: sortAudio(p.audioClips.map((c) => (c.id === next.id ? next : c))) },
    );
  }

  setAdjustments(a: Partial<Adjustments>) {
    this.edit((p) => ({ ...p, adjustments: { ...p.adjustments, ...a } }));
  }
}

export const store = new EditorStore();

/** Subscribe a component to a slice of the store. */
export function useStore<T>(select: (s: EditorState) => T): T {
  const [value, setValue] = useState(() => select(store.get()));
  useEffect(() => {
    const update = () => setValue(() => select(store.get()));
    update();
    return store.subscribe(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
