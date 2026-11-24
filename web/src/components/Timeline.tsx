import { useEffect, useRef, useState } from 'preact/hooks';
import { addMusic, importFiles } from '../actions';
import { preview } from '../media/previewEngine';
import { thumbnail } from '../media/thumbnails';
import { type TrimEdge, store, useStore } from '../model/store';
import { type Clip, type ClipKind, projectDuration, timecode } from '../model/types';
import { MUSIC_DRAG_TYPE, music } from '../music/musicLibrary';

const VIDEO_H = 72;
const AUDIO_H = 56;
const RULER_H = 24;
/** Preact 11 no longer appends "px" to numeric style values. */
const px = (n: number) => `${n}px`;

/** Converts a pointer x to timeline seconds using the scrolling content element. */
function timeAt(content: HTMLElement, clientX: number, pps: number) {
  return Math.max(0, (clientX - content.getBoundingClientRect().left) / pps);
}

export function Timeline() {
  const pps = useStore((s) => s.pixelsPerSecond);
  const duration = useStore((s) => projectDuration(s.project));
  const playhead = useStore((s) => s.playhead);
  const content = useRef<HTMLDivElement>(null);
  const width = Math.max((duration + 15) * pps, 800);

  const scrub = (e: PointerEvent) => {
    const el = content.current;
    if (!el) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (store.get().playing) preview.pause();
    preview.seek(timeAt(el, e.clientX, pps));
  };
  const scrubMove = (e: PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId) || !content.current) return;
    preview.seek(timeAt(content.current, e.clientX, pps));
  };

  return (
    <section class="timeline" aria-label="Timeline">
      <div class="track-headers">
        <div style={{ height: px(RULER_H) }} />
        <div class="track-header" style={{ height: px(VIDEO_H) }}>Video</div>
        <div class="track-header" style={{ height: px(AUDIO_H) }}>Audio</div>
      </div>
      <div class="scroller">
        <div class="timeline-content" ref={content} style={{ width: px(width) }}>
          <Ruler pps={pps} width={width} onPointerDown={scrub} onPointerMove={scrubMove} />
          <TrackRow kind="video" height={VIDEO_H} content={content} onScrub={scrub} onScrubMove={scrubMove} />
          <TrackRow kind="audio" height={AUDIO_H} content={content} onScrub={scrub} onScrubMove={scrubMove} />
          <div class="playhead" style={{ transform: `translateX(${playhead * pps}px)` }} />
        </div>
      </div>
    </section>
  );
}

function Ruler({ pps, width, onPointerDown, onPointerMove }: { pps: number; width: number; onPointerDown: (e: PointerEvent) => void; onPointerMove: (e: PointerEvent) => void }) {
  const every = pps >= 120 ? 1 : pps >= 50 ? 2 : pps >= 25 ? 5 : pps >= 12 ? 10 : 30;
  const labels: number[] = [];
  for (let t = 0; t * pps < width; t += every) labels.push(t);
  return (
    <div class="ruler" style={{ height: px(RULER_H), backgroundSize: `${pps}px 100%` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
      {labels.map((t) => (
        <span key={t} class="ruler-label mono" style={{ left: px(t * pps) }}>{timecode(t)}</span>
      ))}
    </div>
  );
}

interface RowProps {
  kind: ClipKind;
  height: number;
  content: { current: HTMLDivElement | null };
  onScrub: (e: PointerEvent) => void;
  onScrubMove: (e: PointerEvent) => void;
}

function TrackRow({ kind, height, content, onScrub, onScrubMove }: RowProps) {
  const clips = useStore((s) => (kind === 'video' ? s.project.videoClips : s.project.audioClips));
  const pps = useStore((s) => s.pixelsPerSecond);
  const [over, setOver] = useState(false);

  const onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    if (types.includes(MUSIC_DRAG_TYPE) || types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    }
  };
  const onDrop = (e: DragEvent) => {
    setOver(false);
    if (!content.current || !e.dataTransfer) return;
    e.preventDefault();
    e.stopPropagation();
    const t = timeAt(content.current, e.clientX, pps);
    const id = e.dataTransfer.getData(MUSIC_DRAG_TYPE);
    if (id) {
      const track = music.track(id);
      if (track) addMusic(track, t);
      return;
    }
    if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files], t);
  };

  return (
    <div class={`track-row ${kind} ${over ? 'drop-over' : ''}`} style={{ height: px(height) }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) { store.select(null); onScrub(e); } }}
      onPointerMove={onScrubMove}
      onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {clips.length === 0 && (
        <span class="row-hint">{kind === 'video' ? 'Drop video clips here' : 'Drag music here from the library →'}</span>
      )}
      {clips.map((c) => <ClipBlock key={c.id} clip={c} pps={pps} height={height - 10} />)}
    </div>
  );
}

function ClipBlock({ clip, pps, height }: { clip: Clip; pps: number; height: number }) {
  const selected = useStore((s) => s.selectedClipId === clip.id);
  const drag = useRef<{ origin: Clip; x: number; mode: TrimEdge | 'move'; started: boolean } | null>(null);
  const width = Math.max(clip.duration * pps, 6);

  const begin = (e: PointerEvent, mode: TrimEdge | 'move') => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    store.select(clip.id);
    drag.current = { origin: clip, x: e.clientX, mode, started: false };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.started) {
      if (Math.abs(dx) < 3) return;
      if (d.mode === 'move' && clip.kind !== 'audio') return; // video clips don't slide (magnetic track)
      d.started = true;
      store.checkpoint();
    }
    if (d.mode === 'move') store.move(d.origin, dx / pps);
    else store.trim(d.origin, d.mode, dx / pps);
  };
  const end = () => (drag.current = null);

  return (
    <div class={`clip ${clip.kind} ${selected ? 'selected' : ''}`}
      style={{ left: px(clip.timelineStart * pps), width: px(width), height: px(height) }}
      title={`${clip.title} · ${timecode(clip.duration)}`}
      onPointerDown={(e) => begin(e, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {clip.kind === 'video' ? <Thumbs clip={clip} width={width} /> : <div class="wave" />}
      <span class="clip-title">{clip.title}</span>
      <span class="handle start" onPointerDown={(e) => begin(e, 'start')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      <span class="handle end" onPointerDown={(e) => begin(e, 'end')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
  );
}

function Thumbs({ clip, width }: { clip: Clip; width: number }) {
  const count = Math.max(1, Math.min(24, Math.ceil(width / 96)));
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const key = `${clip.sourceId}|${Math.round(clip.sourceStart * 2)}|${Math.round(clip.duration * 2)}|${count}`;
  useEffect(() => {
    let live = true;
    const times = Array.from({ length: count }, (_, i) => clip.sourceStart + (clip.duration * (i + 0.5)) / count);
    Promise.all(times.map((t) => thumbnail(clip.sourceId, t))).then((u) => live && setUrls(u));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div class="thumbs">
      {urls.map((u, i) => (u ? <img key={i} src={u} alt="" draggable={false} /> : <span key={i} />))}
    </div>
  );
}
