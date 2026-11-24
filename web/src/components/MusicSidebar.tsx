import { useEffect, useRef, useState } from 'preact/hooks';
import { addMusic, toast } from '../actions';
import { store } from '../model/store';
import { timecode } from '../model/types';
import { MUSIC_DRAG_TYPE, type MusicTrack, music } from '../music/musicLibrary';
import { Icon } from './Icon';

export function MusicSidebar() {
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async (q = query) => {
    setLoading(true);
    const r = await music.search(q);
    setTracks(r.tracks);
    setErrors(r.errors);
    setLoading(false);
  };

  useEffect(() => {
    const id = setTimeout(() => refresh(query), 150);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const togglePreview = async (t: MusicTrack) => {
    audio.current?.pause();
    if (previewing === t.id) {
      setPreviewing(null);
      return;
    }
    try {
      const file = await music.fileFor(t);
      const a = new Audio(URL.createObjectURL(file));
      a.onended = () => setPreviewing(null);
      audio.current = a;
      await a.play();
      setPreviewing(t.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    await music.user.add([...files]);
    refresh();
  };

  return (
    <aside class="sidebar" aria-label="Music library">
      <div class="sidebar-head">
        <strong>Music</strong>
        <button class="btn small" onClick={() => fileInput.current?.click()} title="Add your own royalty-free audio files (kept on this device)">
          <Icon name="plus" size={14} /> Add audio
        </button>
        <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac" multiple hidden
          onChange={(e) => { addFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
      </div>
      <input class="search" type="search" placeholder="Search title, artist, genre" value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      <ul class="track-list">
        {tracks.map((t) => (
          <li key={t.id} class={`track ${t.available ? '' : 'unavailable'}`} draggable={t.available}
            onDragStart={(e) => {
              e.dataTransfer?.setData(MUSIC_DRAG_TYPE, t.id);
              e.dataTransfer?.setData('text/plain', t.title);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
            }}
            title={t.available ? 'Drag onto the audio track' : 'Placeholder: no audio file yet'}>
            <button class="icon-btn" disabled={!t.available} onClick={() => togglePreview(t)} aria-label="Preview">
              <Icon name={previewing === t.id ? 'stop' : 'play'} size={14} />
            </button>
            <div class="track-meta">
              <div class="track-title">{t.title}</div>
              <div class="muted small">{[t.artist, t.genre, t.duration > 0 ? timecode(t.duration) : ''].filter(Boolean).join(' · ')}</div>
              <div class={`small ${t.available ? 'muted' : 'warn'}`}>{t.available ? t.license : `No file yet · ${t.license}`}</div>
            </div>
            {t.available && (
              <button class="icon-btn" title="Add at playhead" aria-label="Add at playhead" onClick={() => addMusic(t, store.get().playhead)}>
                <Icon name="plus" size={14} />
              </button>
            )}
            {t.sourceName === music.user.name && (
              <button class="icon-btn" title="Remove from my audio" aria-label="Remove" onClick={async () => { await music.user.remove(t.id); refresh(); }}>
                <Icon name="x" size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!loading && tracks.length === 0 && <p class="muted small">No matches.</p>}
      {errors.map((m) => <p key={m} class="warn small">{m}</p>)}
      <p class="muted small foot">
        Drag a track onto the audio row, or press + to add it at the playhead. Only use music whose license allows
        YouTube use, and credit it if the license asks.
      </p>
    </aside>
  );
}
