/**
 * Headless driving surface for WP2's acceptance run (`verify-interview.mjs`)
 * and for the screenshot set.
 *
 * Dev-only by construction: `Interview.tsx` imports this dynamically inside
 * `if (import.meta.env.DEV)`, which Vite folds to `false` in a production
 * build, so the module and its fixtures are dropped from the bundle entirely.
 *
 * It exists because two of the four required screenshots are states the app
 * cannot be talked into from the outside — a 92-minute recording 23 minutes
 * heard, and an interview whose tape is gone — and because the §5 assertions
 * need a recording with known word times rather than whatever a real file
 * happens to contain.
 */
import { FIXTURES } from './Interview.fixtures';
import { putAudio, removeAudio } from '../lib/storage';
import { useStore, usePlayer } from '../store';

/**
 * A real, decodable PCM WAV of `seconds` length. 8 kHz 8-bit mono keeps a
 * 92-minute fixture near 44 MB, which IndexedDB and a blob URL both handle
 * without complaint, and the browser reports its duration from the header the
 * same way it would for a user's recording.
 */
function makeWav(seconds: number, rate = 8000): Blob {
  const frames = Math.max(1, Math.floor(seconds * rate));
  const buf = new ArrayBuffer(44 + frames);
  const view = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + frames, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);      // PCM
  view.setUint16(22, 1, true);      // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);   // byte rate
  view.setUint16(32, 1, true);      // block align
  view.setUint16(34, 8, true);      // bits
  ascii(36, 'data'); view.setUint32(40, frames, true);
  const pcm = new Uint8Array(buf, 44);
  // A quiet tone rather than digital silence: some decoders shortcut a
  // constant buffer, and we want this to behave like an actual recording.
  for (let i = 0; i < frames; i++) {
    pcm[i] = 128 + Math.round(6 * Math.sin((i / rate) * 2 * Math.PI * 220));
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export interface Devkit {
  seed(name: string): Promise<string>;
  dropAudio(id: string): Promise<void>;
  putWav(id: string, seconds: number): Promise<void>;
  store: typeof useStore;
  player: typeof usePlayer;
}

const devkit: Devkit = {
  /** Install a fixture and its audio, then hand back the route id. */
  async seed(name) {
    const make = FIXTURES[name];
    if (!make) throw new Error(`no fixture: ${name}`);
    const fx = make();
    const store = useStore.getState();
    store.upsertInterview(fx.interview);
    store.setTranscript(fx.interview.id, fx.transcript);
    store.setNotes(fx.interview.id, fx.notes);
    if (fx.audioSec > 0) await putAudio(fx.interview.id, makeWav(fx.audioSec));
    else await removeAudio(fx.interview.id);
    return fx.interview.id;
  },
  async dropAudio(id) { await removeAudio(id); },
  async putWav(id, seconds) { await putAudio(id, makeWav(seconds)); },
  store: useStore,
  player: usePlayer,
};

(window as unknown as { __heardDev: Devkit }).__heardDev = devkit;

export default devkit;
