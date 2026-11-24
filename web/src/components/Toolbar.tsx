import { useEffect, useState } from 'preact/hooks';
import { toast } from '../actions';
import { preview } from '../media/previewEngine';
import { store, useStore } from '../model/store';
import { projectDuration, timecode } from '../model/types';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { Icon } from './Icon';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function Toolbar({ onImport, onExport }: { onImport: () => void; onExport: () => void }) {
  const playing = useStore((s) => s.playing);
  const playhead = useStore((s) => s.playhead);
  const duration = useStore((s) => projectDuration(s.project));
  const hasVideo = useStore((s) => s.project.videoClips.length > 0);
  const selected = useStore((s) => s.selectedClipId);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const pps = useStore((s) => s.pixelsPerSecond);
  const [showLighting, setShowLighting] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const split = () => {
    if (!store.splitAtPlayhead()) toast('Put the playhead inside a clip to split it.');
  };

  return (
    <div class="toolbar" role="toolbar">
      <button class="tb" onClick={onImport} title="Import video or audio (Ctrl/⌘ I)"><Icon name="import" /> Import</button>
      <span class="sep" />
      <button class="tb play" onClick={() => preview.toggle()} disabled={duration <= 0} title="Play / Pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <span class="time mono">{timecode(playhead)} / {timecode(duration)}</span>
      <span class="sep" />
      <button class="tb" onClick={split} disabled={duration <= 0} title="Split at playhead (Ctrl/⌘ B)"><Icon name="scissors" /> Split</button>
      <button class="tb" onClick={() => store.deleteSelected()} disabled={!selected} title="Delete selected clip (Delete)"><Icon name="trash" /> Delete</button>
      <button class="tb" onClick={() => store.undo()} disabled={!canUndo} title="Undo (Ctrl/⌘ Z)" aria-label="Undo"><Icon name="undo" /></button>
      <button class="tb" onClick={() => store.redo()} disabled={!canRedo} title="Redo (Shift Ctrl/⌘ Z)" aria-label="Redo"><Icon name="redo" /></button>
      <span class="popover-anchor">
        <button class={`tb ${showLighting ? 'on' : ''}`} onClick={() => setShowLighting(!showLighting)} title="Exposure, brightness, contrast, saturation">
          <Icon name="sun" /> Lighting
        </button>
        {showLighting && <AdjustmentsPanel onClose={() => setShowLighting(false)} />}
      </span>
      <span class="spacer" />
      <label class="zoom" title="Timeline zoom">
        <span class="muted">Zoom</span>
        <input type="range" min={8} max={400} value={pps} onInput={(e) => store.setZoom(Number((e.target as HTMLInputElement).value))} />
      </label>
      {installEvent && (
        <button class="tb" title="Install Video A&M as an app" onClick={async () => {
          await installEvent.prompt();
          setInstallEvent(null);
        }}><Icon name="install" /> Install</button>
      )}
      <button class="btn primary" onClick={onExport} disabled={!hasVideo} title="Export MP4 for YouTube (Ctrl/⌘ E)">
        <Icon name="export" /> Export
      </button>
    </div>
  );
}
