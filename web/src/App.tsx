import { useEffect, useRef, useState } from 'preact/hooks';
import { importFiles, setNotifier } from './actions';
import { ExportDialog } from './components/ExportDialog';
import { MusicSidebar } from './components/MusicSidebar';
import { PlayerView } from './components/PlayerView';
import { Timeline } from './components/Timeline';
import { Toolbar } from './components/Toolbar';
import { preview } from './media/previewEngine';
import { store } from './model/store';

export function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setNotifier((m) => {
      setMessage(m);
      setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 5000);
    });
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ' && !mod) { e.preventDefault(); preview.toggle(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) { e.preventDefault(); store.deleteSelected(); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); store.splitAtPlayhead(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); }
      else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); fileInput.current?.click(); }
      else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); if (store.get().project.videoClips.length) setExportOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openImport = () => fileInput.current?.click();

  return (
    <div class="app"
      onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDropping(false); }}
      onDrop={(e) => {
        setDropping(false);
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        importFiles([...e.dataTransfer.files]);
      }}>
      <main class="editor">
        <PlayerView onImport={openImport} />
        <Toolbar onImport={openImport} onExport={() => setExportOpen(true)} />
        <Timeline />
      </main>
      <MusicSidebar />
      <input ref={fileInput} type="file" multiple hidden
        accept="video/mp4,video/quicktime,video/x-m4v,.mov,.mp4,.m4v,audio/*"
        onChange={(e) => { const el = e.target as HTMLInputElement; if (el.files) importFiles([...el.files]); el.value = ''; }} />
      {dropping && <div class="drop-overlay">Drop to import</div>}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {message && <div class="toast" role="status">{message}</div>}
    </div>
  );
}
