import { isAudioFile, isVideoFile, registerFile } from './media/registry';
import { store } from './model/store';
import { type Clip, uid } from './model/types';
import { type MusicTrack, music } from './music/musicLibrary';

type Notify = (msg: string) => void;
let notify: Notify = (m) => console.warn(m);
export const setNotifier = (fn: Notify) => (notify = fn);
export const toast = (m: string) => notify(m);

/** Imports dropped / picked files. Videos go on the video track, audio files on the audio track at `audioAt`. */
export async function importFiles(files: File[], audioAt = store.get().playhead) {
  const clips: Clip[] = [];
  const failed: string[] = [];
  let firstName: string | undefined;
  for (const file of files) {
    const video = isVideoFile(file);
    if (!video && !isAudioFile(file)) {
      failed.push(`${file.name} (not a video or audio file)`);
      continue;
    }
    try {
      const m = await registerFile(file);
      if (m.duration <= 0.1) throw new Error('too short');
      if (m.hasVideo) {
        firstName ??= m.name;
        clips.push({ id: uid(), kind: 'video', sourceId: m.id, title: m.name, sourceDuration: m.duration, sourceStart: 0, duration: m.duration, timelineStart: 0, volume: 1 });
      } else {
        clips.push({ id: uid(), kind: 'audio', sourceId: m.id, title: m.name, sourceDuration: m.duration, sourceStart: 0, duration: m.duration, timelineStart: Math.max(0, audioAt), volume: 0.8 });
      }
    } catch (e) {
      failed.push(`${file.name} (${e instanceof Error ? e.message : 'unreadable'})`);
    }
  }
  store.addClips(clips, firstName);
  if (failed.length) notify(`Couldn’t import: ${failed.join(', ')}`);
}

/** Drops a library track onto the audio track at `time`. */
export async function addMusic(track: MusicTrack, time: number) {
  try {
    const file = await music.fileFor(track);
    const m = await registerFile(file, `music:${track.id}`);
    const length = m.duration || track.duration;
    const clip: Clip = { id: uid(), kind: 'audio', sourceId: m.id, title: track.title, sourceDuration: length, sourceStart: 0, duration: length, timelineStart: Math.max(0, time), volume: 0.8 };
    store.addClips([clip]);
    store.select(clip.id);
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e));
  }
}
