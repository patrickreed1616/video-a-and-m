import { useEffect, useRef } from 'preact/hooks';
import { preview } from '../media/previewEngine';
import { useStore } from '../model/store';

export function PlayerView({ onImport }: { onImport: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const empty = useStore((s) => s.project.videoClips.length === 0);

  useEffect(() => {
    if (canvas.current) {
      try {
        preview.attach(canvas.current);
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  return (
    <section class="player" aria-label="Preview">
      <canvas ref={canvas} class="player-canvas" />
      {empty && (
        <div class="empty">
          <div class="empty-title">Drop video files here</div>
          <div class="muted">.mov · .mp4 · .m4v. Everything stays on this device.</div>
          <button class="btn" onClick={onImport}>Import…</button>
        </div>
      )}
    </section>
  );
}
