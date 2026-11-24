import { registerFile } from '../media/registry';

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  genre: string;
  /** Seconds (0 = unknown). */
  duration: number;
  license: string;
  licenseUrl?: string;
  /** Which source produced it. */
  sourceName: string;
  /** False for catalog entries whose audio file hasn't been added yet. */
  available: boolean;
  /** True for the placeholder rows in catalog.json. */
  example?: boolean;
}

/**
 * Anything that can list royalty-free music. Implement this to plug in a remote catalog
 * (e.g. Freesound) later; see FreesoundSource below and the README.
 */
export interface MusicSource {
  readonly name: string;
  search(query: string, signal?: AbortSignal): Promise<MusicTrack[]>;
  /** Returns the audio as a File (local sources return it directly; remote sources download it). */
  getFile(track: MusicTrack): Promise<File>;
}

const matches = (t: MusicTrack, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || [t.title, t.artist, t.genre].some((x) => x.toLowerCase().includes(s));
};

// ---------------------------------------------------------------------------
// Bundled catalog: public/music/catalog.json (+ audio files next to it)

interface CatalogEntry {
  id: string; title: string; artist: string; genre: string; duration: number;
  license: string; licenseUrl?: string | null; file: string; example?: boolean;
}

export class BundledCatalogSource implements MusicSource {
  readonly name = 'Built-in';
  private entries: Promise<{ entry: CatalogEntry; available: boolean }[]> | null = null;

  private load() {
    if (!this.entries) {
      this.entries = (async () => {
        const res = await fetch(`${import.meta.env.BASE_URL}music/catalog.json`, { cache: 'no-cache' });
        if (!res.ok) return [];
        const json = (await res.json()) as { tracks: CatalogEntry[] };
        return Promise.all(json.tracks.map(async (entry) => ({ entry, available: !entry.example && (await this.exists(entry.file)) })));
      })().catch(() => []);
    }
    return this.entries;
  }

  private async exists(file: string) {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}music/${encodeURIComponent(file)}`, { method: 'HEAD' });
      return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
    } catch {
      return false;
    }
  }

  async search(query: string) {
    return (await this.load())
      .map(({ entry, available }) => ({
        id: `bundled:${entry.id}`, title: entry.title, artist: entry.artist, genre: entry.genre,
        duration: entry.duration, license: entry.license, licenseUrl: entry.licenseUrl ?? undefined,
        sourceName: this.name, available, example: entry.example,
      }))
      .filter((t) => matches(t, query));
  }

  async getFile(track: MusicTrack) {
    const entry = (await this.load()).find((e) => `bundled:${e.entry.id}` === track.id)?.entry;
    if (!entry || !track.available) throw new Error(`The audio file for “${track.title}” hasn’t been added yet.`);
    const res = await fetch(`${import.meta.env.BASE_URL}music/${encodeURIComponent(entry.file)}`);
    if (!res.ok) throw new Error(`Couldn’t load ${entry.file}`);
    return new File([await res.blob()], entry.file, { type: res.headers.get('content-type') ?? '' });
  }
}

// ---------------------------------------------------------------------------
// "My audio": files the user adds, kept in IndexedDB so they survive reloads (stays on this device).

const DB = 'video-a-and-m';
const STORE = 'user-audio';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredAudio { id: string; name: string; duration: number; file: File }

export class UserFilesSource implements MusicSource {
  readonly name = 'My audio';

  private async all(): Promise<StoredAudio[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredAudio[]);
      req.onerror = () => reject(req.error);
    });
  }

  async add(files: File[]) {
    const db = await openDb();
    for (const file of files) {
      const id = `user:${file.name}:${file.size}`;
      let duration = 0;
      try {
        duration = (await registerFile(file, id)).duration;
      } catch {
        continue; // not decodable audio
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id, name: file.name, duration, file } satisfies StoredAudio);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  async remove(id: string) {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async search(query: string) {
    const rows = await this.all().catch(() => []);
    return rows
      .map((r) => ({
        id: r.id, title: r.name.replace(/\.[^.]+$/, ''), artist: 'Your file', genre: '', duration: r.duration,
        license: 'Your file: confirm it is royalty-free', sourceName: this.name, available: true,
      }))
      .filter((t) => matches(t, query))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async getFile(track: MusicTrack) {
    const row = (await this.all()).find((r) => r.id === track.id);
    if (!row) throw new Error('That file is no longer in your library.');
    return row.file;
  }
}

// ---------------------------------------------------------------------------
// Remote source template. NOT enabled. See README "Adding a Freesound source".

export class FreesoundSource implements MusicSource {
  readonly name = 'Freesound';
  constructor(private readonly apiKey: string | undefined) {}

  async search(_query: string): Promise<MusicTrack[]> {
    if (!this.apiKey) throw new Error('Freesound: no API key configured.');
    // TODO: GET https://freesound.org/apiv2/search/text/?query=…&filter=license:"Creative Commons 0"
    //       &fields=id,name,username,duration,license,previews&token=API_KEY
    //       and map results to MusicTrack (license from the response).
    return [];
  }

  async getFile(_track: MusicTrack): Promise<File> {
    // TODO: previews download with the API key; original files need OAuth2.
    throw new Error('Freesound downloads are not implemented yet.');
  }
}

// ---------------------------------------------------------------------------

export class MusicLibrary {
  readonly user = new UserFilesSource();
  readonly sources: MusicSource[] = [new BundledCatalogSource(), this.user];
  private byId = new Map<string, MusicTrack>();

  async search(query: string): Promise<{ tracks: MusicTrack[]; errors: string[] }> {
    const errors: string[] = [];
    const lists = await Promise.all(
      this.sources.map((s) => s.search(query).catch((e: unknown) => {
        errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
        return [] as MusicTrack[];
      })),
    );
    const tracks = lists.flat().sort((a, b) => Number(b.available) - Number(a.available) || a.title.localeCompare(b.title));
    tracks.forEach((t) => this.byId.set(t.id, t));
    return { tracks, errors };
  }

  track(id: string) {
    return this.byId.get(id);
  }

  async fileFor(track: MusicTrack): Promise<File> {
    const source = this.sources.find((s) => s.name === track.sourceName);
    if (!source) throw new Error('Unknown music source.');
    return source.getFile(track);
  }
}

export const music = new MusicLibrary();
export const MUSIC_DRAG_TYPE = 'application/x-video-a-and-m-music';
