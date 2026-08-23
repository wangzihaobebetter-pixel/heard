/**
 * The single application store (DESIGN §9 "Store contracts"). WP0 owns this
 * file and freezes its shape; packages import `useStore` and the selectors
 * below and nobody redefines state.
 *
 * Persisted to IndexedDB under `heard-v1` via zustand `persist`, with a
 * localStorage fallback (src/lib/storage.ts) and versioned migrations.
 * Two things deliberately do NOT live here:
 *   - audio blobs → `audio:<interviewId>` in IndexedDB (they are 40 MB each)
 *   - the player   → `usePlayer`, below, never persisted
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Anchor, Interview, Note, PersistedState, PlayerState, Settings, Transcript,
} from '../types';
import { STORE_VERSION } from '../types';
import { idbStorage, removeAudio, writeUiSlice } from '../lib/storage';
import { id, now } from '../lib/ids';
import { LLM_PRESETS, STT_PRESETS } from './presets';

export const DEFAULT_SETTINGS: Settings = {
  stt: { preset: 'openai', baseUrl: STT_PRESETS[0].baseUrl, key: '', model: STT_PRESETS[0].model, vocabulary: '' },
  llm: { preset: 'openai', baseUrl: LLM_PRESETS[0].baseUrl, key: '', model: LLM_PRESETS[0].model },
  ui: { lang: 'en', theme: 'system', keepAudio: true, speed: 1 },
};

const EMPTY: PersistedState = {
  v: STORE_VERSION,
  settings: DEFAULT_SETTINGS,
  interviews: {},
  transcripts: {},
  notes: {},
  currentInterviewId: null,
  ui: { firstRunSeen: false, sampleDismissed: false },
};

interface Actions {
  /* settings */
  setSettings: (patch: DeepPartialSettings) => void;
  applySttPreset: (preset: Settings['stt']['preset']) => void;
  applyLlmPreset: (preset: Settings['llm']['preset']) => void;

  /* interviews */
  upsertInterview: (interview: Interview) => void;
  createInterview: (init: Partial<Interview> & Pick<Interview, 'title' | 'durationSec' | 'file'>) => Interview;
  updateInterview: (interviewId: string, patch: Partial<Interview>) => void;
  /** Deletes the interview, its transcript, its notes and its audio blob. */
  deleteInterview: (interviewId: string) => void;
  setCurrentInterview: (interviewId: string | null) => void;

  /* transcripts */
  setTranscript: (interviewId: string, transcript: Transcript) => void;
  patchTranscript: (interviewId: string, patch: Partial<Transcript>) => void;

  /* notes */
  setNotes: (interviewId: string, notes: Note[]) => void;
  addNote: (interviewId: string, init: Partial<Note> & Pick<Note, 'kind' | 'text' | 'anchor'>) => Note;
  updateNote: (interviewId: string, noteId: string, patch: Partial<Note>) => void;
  deleteNote: (interviewId: string, noteId: string) => void;
  toggleHeard: (interviewId: string, noteId: string) => void;
  /** "Pin here" — a human moved the anchor, so it is marked as theirs (DESIGN §5). */
  pinNote: (interviewId: string, noteId: string, anchor: Anchor) => void;

  /* storage */
  forgetAudio: (interviewId: string) => Promise<void>;
  setUi: (patch: Partial<PersistedState['ui']>) => void;
  wipeAll: () => void;
}

type DeepPartialSettings = {
  stt?: Partial<Settings['stt']>;
  llm?: Partial<Settings['llm']>;
  ui?: Partial<Settings['ui']>;
};

export type Store = PersistedState & Actions;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      /* ---------------------------------------------------------- settings */

      setSettings: (patch) => {
        const s = get().settings;
        const next: Settings = {
          stt: { ...s.stt, ...patch.stt },
          llm: { ...s.llm, ...patch.llm },
          ui: { ...s.ui, ...patch.ui },
        };
        set({ settings: next });
        // Theme and language are also mirrored to localStorage so index.html can
        // read them synchronously before the first paint.
        if (patch.ui?.theme || patch.ui?.lang) {
          writeUiSlice({ theme: next.ui.theme, lang: next.ui.lang });
        }
      },

      applySttPreset: (preset) => {
        const p = STT_PRESETS.find((x) => x.id === preset);
        if (!p) return;
        const keep = preset === 'custom';
        get().setSettings({
          stt: {
            preset,
            baseUrl: keep ? get().settings.stt.baseUrl : p.baseUrl,
            model: keep ? get().settings.stt.model : p.model,
          },
        });
      },

      applyLlmPreset: (preset) => {
        const p = LLM_PRESETS.find((x) => x.id === preset);
        if (!p) return;
        const keep = preset === 'custom';
        get().setSettings({
          llm: {
            preset,
            baseUrl: keep ? get().settings.llm.baseUrl : p.baseUrl,
            model: keep ? get().settings.llm.model : p.model,
          },
        });
      },

      /* -------------------------------------------------------- interviews */

      upsertInterview: (interview) => {
        set({ interviews: { ...get().interviews, [interview.id]: interview } });
      },

      createInterview: (init) => {
        const interview: Interview = {
          id: init.id ?? id('iv'),
          title: init.title,
          createdAt: init.createdAt ?? now(),
          recordedAt: init.recordedAt,
          durationSec: init.durationSec,
          file: init.file,
          lang: init.lang ?? 'auto',
          status: init.status ?? 'listening',
          sample: init.sample,
        };
        get().upsertInterview(interview);
        return interview;
      },

      updateInterview: (interviewId, patch) => {
        const existing = get().interviews[interviewId];
        if (!existing) return;
        set({ interviews: { ...get().interviews, [interviewId]: { ...existing, ...patch } } });
      },

      deleteInterview: (interviewId) => {
        const interviews = { ...get().interviews };
        const transcripts = { ...get().transcripts };
        const notes = { ...get().notes };
        delete interviews[interviewId];
        delete transcripts[interviewId];
        delete notes[interviewId];
        set({
          interviews,
          transcripts,
          notes,
          currentInterviewId: get().currentInterviewId === interviewId ? null : get().currentInterviewId,
        });
        void removeAudio(interviewId);
      },

      setCurrentInterview: (interviewId) => set({ currentInterviewId: interviewId }),

      /* -------------------------------------------------------- transcripts */

      setTranscript: (interviewId, transcript) => {
        set({ transcripts: { ...get().transcripts, [interviewId]: transcript } });
      },

      patchTranscript: (interviewId, patch) => {
        const existing = get().transcripts[interviewId];
        if (!existing) return;
        set({ transcripts: { ...get().transcripts, [interviewId]: { ...existing, ...patch } } });
      },

      /* -------------------------------------------------------------- notes */

      setNotes: (interviewId, notes) => {
        set({ notes: { ...get().notes, [interviewId]: notes } });
      },

      addNote: (interviewId, init) => {
        const note: Note = {
          id: init.id ?? id('n'),
          kind: init.kind,
          text: init.text,
          quote: init.quote,
          anchor: init.anchor,
          heard: init.heard ?? false,
          createdAt: init.createdAt ?? now(),
          updatedAt: init.updatedAt ?? now(),
        };
        const list = get().notes[interviewId] ?? [];
        get().setNotes(interviewId, [...list, note]);
        return note;
      },

      updateNote: (interviewId, noteId, patch) => {
        const list = get().notes[interviewId];
        if (!list) return;
        get().setNotes(
          interviewId,
          list.map((n) => (n.id === noteId ? { ...n, ...patch, updatedAt: now() } : n)),
        );
      },

      deleteNote: (interviewId, noteId) => {
        const list = get().notes[interviewId];
        if (!list) return;
        get().setNotes(interviewId, list.filter((n) => n.id !== noteId));
      },

      toggleHeard: (interviewId, noteId) => {
        const note = (get().notes[interviewId] ?? []).find((n) => n.id === noteId);
        if (!note) return;
        get().updateNote(interviewId, noteId, { heard: !note.heard });
      },

      pinNote: (interviewId, noteId, anchor) => {
        get().updateNote(interviewId, noteId, { anchor: { ...anchor, pinnedByUser: true } });
      },

      /* ------------------------------------------------------------ storage */

      forgetAudio: async (interviewId) => {
        await removeAudio(interviewId);
        const existing = get().interviews[interviewId];
        if (existing) {
          get().updateInterview(interviewId, { file: { ...existing.file, kept: false } });
        }
      },

      setUi: (patch) => set({ ui: { ...get().ui, ...patch } }),

      wipeAll: () => {
        for (const key of Object.keys(get().interviews)) void removeAudio(key);
        set({ ...EMPTY, settings: get().settings });
      },
    }),
    {
      name: 'heard-v1',
      version: STORE_VERSION,
      storage: createJSONStorage(() => idbStorage),
      // Actions are recreated on every boot; only the data is persisted.
      partialize: (s): PersistedState => ({
        v: s.v,
        settings: s.settings,
        interviews: s.interviews,
        transcripts: s.transcripts,
        notes: s.notes,
        currentInterviewId: s.currentInterviewId,
        ui: s.ui,
      }),
      /**
       * Migrations. There is only one version today; the switch exists so that
       * the first schema change is a two-line edit rather than a data loss.
       * Rule: a migration never throws — a store that will not hydrate is worse
       * than a store missing a field.
       */
      migrate: (persisted, from) => {
        const state = (persisted ?? {}) as Partial<PersistedState>;
        if (from < 1) {
          return { ...EMPTY, ...state, v: STORE_VERSION };
        }
        return { ...EMPTY, ...state, v: STORE_VERSION };
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedState>;
        return {
          ...current,
          ...p,
          // Settings gain fields between versions; a persisted partial must not
          // erase a default that new code depends on.
          settings: {
            stt: { ...DEFAULT_SETTINGS.stt, ...(p.settings?.stt ?? {}) },
            llm: { ...DEFAULT_SETTINGS.llm, ...(p.settings?.llm ?? {}) },
            ui: { ...DEFAULT_SETTINGS.ui, ...(p.settings?.ui ?? {}) },
          },
          ui: { ...EMPTY.ui, ...(p.ui ?? {}) },
        };
      },
    },
  ),
);

/* ------------------------------------------------------------- selectors */

export const selectInterviewList = (s: Store): Interview[] =>
  Object.values(s.interviews).sort((a, b) => b.createdAt - a.createdAt);

export const selectInterview = (interviewId: string) => (s: Store): Interview | undefined =>
  s.interviews[interviewId];

export const selectTranscript = (interviewId: string) => (s: Store): Transcript | undefined =>
  s.transcripts[interviewId];

export const selectNotes = (interviewId: string) => (s: Store): Note[] =>
  s.notes[interviewId] ?? [];

export const selectNotesOfKind = (interviewId: string, kind: Note['kind']) => (s: Store): Note[] =>
  (s.notes[interviewId] ?? []).filter((n) => n.kind === kind);

export const selectHeardCount = (interviewId: string) => (s: Store): number =>
  (s.notes[interviewId] ?? []).filter((n) => n.heard).length;

/* ---------------------------------------------------------------- player */

/**
 * Player state. Deliberately a separate, NON-persisted store: reloading the
 * page should not resume audio, and WP1's controller writes to this many times
 * a second — it must never touch the persisted store.
 */
interface PlayerActions {
  setPlayer: (patch: Partial<PlayerState>) => void;
  resetPlayer: () => void;
}

const EMPTY_PLAYER: PlayerState = {
  interviewId: null,
  currentTime: 0,
  playing: false,
  span: undefined,
  mode: 'free',
  wordIndex: -1,
};

export const usePlayer = create<PlayerState & PlayerActions>()((set) => ({
  ...EMPTY_PLAYER,
  setPlayer: (patch) => set(patch),
  resetPlayer: () => set(EMPTY_PLAYER),
}));
