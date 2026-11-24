import { store, useStore } from '../model/store';
import { type Adjustments, NEUTRAL_ADJUSTMENTS } from '../model/types';

const ROWS: { key: keyof Adjustments; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} EV` },
  { key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}` },
  { key: 'contrast', label: 'Contrast', min: 0.5, max: 1.5, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, fmt: (v) => v.toFixed(2) },
];

/** Whole-video lighting; the same WebGL shader runs in preview and export. */
export function AdjustmentsPanel({ onClose }: { onClose: () => void }) {
  const a = useStore((s) => s.project.adjustments);
  const neutral = ROWS.every((r) => a[r.key] === NEUTRAL_ADJUSTMENTS[r.key]);
  return (
    <div class="popover" role="dialog" aria-label="Lighting">
      <div class="popover-head">
        <strong>Lighting</strong>
        <button class="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      {ROWS.map((r) => (
        <label class="slider-row" key={r.key}>
          <span class="slider-label">{r.label}<span class="mono muted">{r.fmt(a[r.key])}</span></span>
          <input type="range" min={r.min} max={r.max} step={r.step} value={a[r.key]}
            onPointerDown={() => store.checkpoint()}
            onDblClick={() => { store.checkpoint(); store.setAdjustments({ [r.key]: NEUTRAL_ADJUSTMENTS[r.key] }); }}
            onInput={(e) => store.setAdjustments({ [r.key]: Number((e.target as HTMLInputElement).value) })} />
        </label>
      ))}
      <div class="row-end">
        <button class="btn" disabled={neutral} onClick={() => { store.checkpoint(); store.setAdjustments({ ...NEUTRAL_ADJUSTMENTS }); }}>Reset</button>
      </div>
    </div>
  );
}
