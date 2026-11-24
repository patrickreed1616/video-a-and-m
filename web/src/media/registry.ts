import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

/** An imported file. Kept outside the undoable project state. */
export interface MediaItem {
  id: string;
  file: File;
  url: string;
  name: string;
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
}

const items = new Map<string, MediaItem>();

export const VIDEO_EXT = ['mov', 'mp4', 'm4v'];
export const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus', 'webm'];

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
export const isVideoFile = (f: File) => VIDEO_EXT.includes(ext(f.name)) || f.type.startsWith('video/');
export const isAudioFile = (f: File) => AUDIO_EXT.includes(ext(f.name)) || f.type.startsWith('audio/');

export function getMedia(id: string): MediaItem | undefined {
  return items.get(id);
}

/** Reads duration / tracks / size with Mediabunny (demux only, no decoding). */
export async function registerFile(file: File, id: string = crypto.randomUUID()): Promise<MediaItem> {
  const existing = items.get(id);
  if (existing) return existing;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) throw new Error('no audio or video track found');
    const duration = await input.computeDuration();
    const item: MediaItem = {
      id,
      file,
      url: URL.createObjectURL(file),
      name: file.name.replace(/\.[^.]+$/, ''),
      duration,
      hasVideo: !!video,
      hasAudio: !!audio,
      width: video ? video.displayWidth : 0,
      height: video ? video.displayHeight : 0,
    };
    items.set(id, item);
    return item;
  } finally {
    input.dispose();
  }
}
