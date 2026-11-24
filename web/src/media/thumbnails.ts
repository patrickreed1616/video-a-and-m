import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { getMedia } from './registry';

const cache = new Map<string, string>(); // key -> JPEG data URL
const sinks = new Map<string, Promise<CanvasSink | null>>();
let queue: Promise<unknown> = Promise.resolve();

function sinkFor(sourceId: string): Promise<CanvasSink | null> {
  let s = sinks.get(sourceId);
  if (!s) {
    s = (async () => {
      const m = getMedia(sourceId);
      if (!m || !m.hasVideo) return null;
      const input = new Input({ source: new BlobSource(m.file), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) return null;
      return new CanvasSink(track, { height: 72 });
    })().catch(() => null);
    sinks.set(sourceId, s);
  }
  return s;
}

/** Small frame at ~time (rounded to 0.5 s so trimming reuses cached frames). Requests are serialized. */
export function thumbnail(sourceId: string, time: number): Promise<string | null> {
  const t = Math.round(time * 2) / 2;
  const key = `${sourceId}@${t}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const again = cache.get(key);
    if (again) return again;
    const sink = await sinkFor(sourceId);
    if (!sink) return null;
    const wc = await sink.getCanvas(t);
    if (!wc) return null;
    const c = wc.canvas as HTMLCanvasElement;
    const url = c.toDataURL('image/jpeg', 0.6);
    if (cache.size > 800) cache.clear();
    cache.set(key, url);
    return url;
  });
  queue = job.catch(() => null);
  return job.catch(() => null);
}
