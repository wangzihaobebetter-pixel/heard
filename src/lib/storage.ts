/**
 * Persistence adapters (DESIGN §7, §9). WP0 owns this file.
 *
 * Three tiers, kept apart on purpose:
 *  1. `uiSlice` — localStorage, synchronous, read in index.html BEFORE paint so
 *     the first frame is already the right theme and language.
 *  2. `idbStorage` — the zustand `persist` adapter. IndexedDB, with a
 *     localStorage fallback so private-mode Safari degrades instead of failing.
 *  3. `audio:<interviewId>` — the original file Blob, in IndexedDB and never in
 *     zustand. A 44 MB blob does not belong in a JSON-serialised store.
 */
import { get, set, del, keys } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

/* ------------------------------------------------------- persist adapter */

let idbBroken = false;

const lsFallback: StateStorage = {
  getItem: (name) => {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name, value) => {
    try { localStorage.setItem(name, value); } catch { /* quota — drop silently */ }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* noop */ }
  },
};

export const idbStorage: StateStorage = {
  async getItem(name) {
    if (idbBroken) return lsFallback.getItem(name);
    try {
      const v = await get<string>(name);
      return v ?? null;
    } catch {
      idbBroken = true;
      return lsFallback.getItem(name);
    }
  },
  async setItem(name, value) {
    if (idbBroken) return lsFallback.setItem(name, value);
    try { await set(name, value); } catch {
      idbBroken = true;
      lsFallback.setItem(name, value);
    }
  },
  async removeItem(name) {
    if (idbBroken) return lsFallback.removeItem(name);
    try { await del(name); } catch {
      idbBroken = true;
      lsFallback.removeItem(name);
    }
  },
};

/** True once IndexedDB has thrown at us and we fell back. Settings → Storage shows it. */
export function isStorageDegraded(): boolean {
  return idbBroken;
}

/* ------------------------------------------------------------ audio blobs */

export const audioKey = (interviewId: string) => `audio:${interviewId}`;

export async function putAudio(interviewId: string, blob: Blob): Promise<void> {
  await set(audioKey(interviewId), blob);
}

/** null means "the recording isn't on this device" — a real, designed state, not an error. */
export async function getAudio(interviewId: string): Promise<Blob | null> {
  try {
    const blob = await get<Blob>(audioKey(interviewId));
    return blob ?? null;
  } catch {
    return null;
  }
}

export async function removeAudio(interviewId: string): Promise<void> {
  try { await del(audioKey(interviewId)); } catch { /* already gone is fine */ }
}

export async function hasAudio(interviewId: string): Promise<boolean> {
  return (await getAudio(interviewId)) !== null;
}

/** Total bytes held on this device, for Settings → Storage. */
export async function audioBytes(): Promise<number> {
  try {
    const all = await keys();
    let total = 0;
    for (const k of all) {
      if (typeof k !== 'string' || !k.startsWith('audio:')) continue;
      const blob = await get<Blob>(k);
      if (blob) total += blob.size;
    }
    return total;
  } catch {
    return 0;
  }
}

/* ---------------------------------------------------------- pre-paint slice */

export const UI_SLICE_KEY = 'heard-ui';

export interface UiSlice { theme?: string; lang?: string }

export function readUiSlice(): UiSlice {
  try { return JSON.parse(localStorage.getItem(UI_SLICE_KEY) || '{}'); } catch { return {}; }
}

export function writeUiSlice(patch: UiSlice): void {
  try {
    localStorage.setItem(UI_SLICE_KEY, JSON.stringify({ ...readUiSlice(), ...patch }));
  } catch { /* noop */ }
}
