import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_PRESET, PRESETS, type SupportReport, checkSupport, exportProject, outputSize, presetDetail } from '../media/exporter';
import { preview } from '../media/previewEngine';
import { store } from '../model/store';

type SaveFilePicker = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const preset = PRESETS.find((p) => p.id === presetId) ?? DEFAULT_PRESET;
  const [support, setSupport] = useState<SupportReport | null>(null);
  const [progress, setProgress] = useState<{ value: number; stage: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const project = store.get().project;
  const size = outputSize(project, preset);

  useEffect(() => {
    let live = true;
    setSupport(null);
    checkSupport(project, preset).then((s) => live && setSupport(s));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  const run = async () => {
    setError(null);
    setResult(null);
    preview.pause();
    const fileName = `${project.name || 'video'} ${preset.id}.mp4`.replace(/[\\/:*?"<>|]/g, '-');
    let handle: FileSystemFileHandle | undefined;
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (picker) {
      try {
        handle = await picker({ suggestedName: fileName, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      } catch {
        return; // user closed the save dialog
      }
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ value: 0, stage: 'Preparing…' });
    try {
      const blob = await exportProject({
        project: store.get().project, preset, fileHandle: handle, signal: ctrl.signal,
        onProgress: (value, stage) => setProgress({ value, stage }),
      });
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setResult(`Downloaded ${fileName}`);
      } else {
        setResult(`Saved ${handle?.name ?? fileName}`);
      }
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) setResult('Export cancelled.');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const busy = progress !== null;
  return (
    <div class="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div class="modal" role="dialog" aria-label="Export for YouTube">
        <h2>Export for YouTube</h2>
        <fieldset disabled={busy}>
          {PRESETS.map((p) => (
            <label key={p.id} class="radio">
              <input type="radio" name="preset" checked={p.id === presetId} onChange={() => setPresetId(p.id)} /> {p.label}
            </label>
          ))}
        </fieldset>
        <p class="muted small">{presetDetail(preset)} · {size.width}×{size.height}</p>
        {support && !support.ok && <p class="warn">{support.message}</p>}
        {support?.ok && support.message && <p class="muted small">{support.message}</p>}
        {support?.ok && !support.nativeAac && <p class="muted small">Using the built-in AAC encoder (this browser has no native AAC).</p>}
        {busy && (
          <div class="progress">
            <div class="progress-label"><span>{progress.stage}</span><span class="mono">{Math.round(progress.value * 100)}%</span></div>
            <progress max={1} value={progress.value} />
          </div>
        )}
        {result && <p class="ok">{result}</p>}
        {error && <p class="warn">{error}</p>}
        <div class="row-end">
          {busy ? (
            <button class="btn" onClick={() => abort.current?.abort()}>Cancel export</button>
          ) : (
            <>
              <button class="btn" onClick={onClose}>Close</button>
              <button class="btn primary" disabled={!support?.ok || project.videoClips.length === 0} onClick={run}>Export…</button>
            </>
          )}
        </div>
        <p class="muted small">Rendering happens on this device. Keep this tab open until it finishes.</p>
      </div>
    </div>
  );
}
