/**
 * Library `#/` (DESIGN §4.1). WP3 owns this screen.
 *
 * "Get to an interview in one tap; make bringing a new one obvious." That is
 * the whole brief, so the screen is a button and a list and nothing else — no
 * dashboard, no counts of counts, no empty-state illustration.
 *
 * States built here, all of them from §4.1:
 *   · the list, with the sample card carrying its NASA tag
 *   · the one-line lede on the sample ("Try pressing any timecode.")
 *   · the empty state, reachable only by deleting the sample
 *   · the storage read failure, with Retry
 *   · a card mid-transcription: progress hairline + "Heard 41 of 92 min"
 *
 * `?fixture=…` — a query-string hook used by `verify-export.mjs` to render the
 * states that need data we do not have on a clean machine (an empty library, a
 * broken IndexedDB, a half-heard recording, the export sheet). Fixtures are
 * render-only: nothing below writes a fixture into the store, so no screenshot
 * run can leave residue in a real profile. The integrator may delete this hook
 * once WP2's Export button and a seeded QA profile exist.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Interview, Note } from '../types';
import { useT } from '../i18n';
import { getCachedPeaks } from '../audio/peaks';
import Waveform from '../components/Waveform';
import { href } from '../router';
import { useStore, selectInterviewList } from '../store';
import { isStorageDegraded } from '../lib/storage';
import { formatDuration, minutesOf } from '../lib/time';
import { formatSheetDate } from '../export/quotesheet';
import { EXPORT_FIXTURE_INTERVIEW, EXPORT_FIXTURE_NOTES } from '../export/fixture';
import { ensureSample } from '../sample/load';
import { SAMPLE_ID } from '../sample/schema';
import ExportSheet from '../components/ExportSheet';
import Toast, { useToast } from '../components/Toast';
import '../components/ui.css';
import './Library.css';

function fixture(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('fixture') ?? '';
}

/* --------------------------------------------------------------- fixtures */

/** The §4.5 worked example lives in `src/export/fixture.ts` so that
    `verify-export.mjs` can run the real generator over the very same data. */

/** A recording still being heard — §4.1's "Heard 41 of 92 min" card. */
const LISTENING_FIXTURE: Interview = {
  id: 'fixture-listening',
  title: 'Board meeting, second session',
  createdAt: new Date(2026, 7, 20, 9).getTime(),
  recordedAt: new Date(2026, 7, 20, 9).getTime(),
  durationSec: 5520, // 92 min
  file: { name: 'board-2.m4a', size: 41 * 1024 * 1024, type: 'audio/mp4', kept: true },
  lang: 'auto',
  status: 'listening',
};

/* ------------------------------------------------------------------ screen */

export default function Library() {
  const t = useT();
  const fx = fixture();
  const toast = useToast();

  const interviews = useStore(selectInterviewList);
  const notes = useStore((s) => s.notes);
  const transcripts = useStore((s) => s.transcripts);
  const theme = useStore((s) => s.settings.ui.theme);
  const setSettings = useStore((s) => s.setSettings);
  const setUi = useStore((s) => s.setUi);

  const [storageFailed, setStorageFailed] = useState(false);
  const [exportOpen, setExportOpen] = useState(fx === 'export');

  // The persist adapter degrades quietly (it falls back to localStorage rather
  // than throwing), so the screen asks it afterwards instead of try/catching a
  // read it does not perform.
  useEffect(() => { setStorageFailed(isStorageDegraded()); }, [interviews.length]);

  const shown = useMemo(() => {
    if (fx === 'empty' || fx === 'storage') return [];
    if (fx === 'listening') return [LISTENING_FIXTURE, ...interviews];
    return interviews;
  }, [fx, interviews]);

  const failed = storageFailed || fx === 'storage';
  const sample = shown.find((i) => i.id === SAMPLE_ID);
  // §4.1: the lede is the invitation, so it retires once the person has taken it.
  const sampleUntouched = !!sample && !(notes[SAMPLE_ID] ?? []).some((n) => n.heard);

  /** "Toggle" means the two you can see, so it flips against what is on screen. */
  function toggleTheme() {
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper')
      : theme;
    setSettings({ ui: { theme: resolved === 'ink' ? 'paper' : 'ink' } });
  }

  function bringSampleBack() {
    setUi({ sampleDismissed: false });
    ensureSample();
  }

  return (
    <>
      <header className="topbar">
        <a className="topbar__name" href={href('library')}>{t('app.name')}</a>
        <span className="topbar__spacer" />
        <button
          type="button"
          className="iconbutton"
          aria-label={t('settings.theme')}
          data-testid="theme-toggle"
          onClick={toggleTheme}
        >
          ◐
        </button>
        <a className="iconbutton" href={href('settings')} aria-label={t('settings.title')} data-testid="settings-link">
          ⚙
        </a>
      </header>

      <main className="screen library" data-screen="library">
        <h1 className="screen__title">{t('library.title')}</h1>

        <a className="button button--primary button--wide library__bring" href={href('bring')}>
          {t('action.bringRecording')}
        </a>

        {failed ? (
          <div className="notice" data-testid="library-read-failed">
            <p className="notice__text">{t('library.readFailed')}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => { void useStore.persist.rehydrate(); setStorageFailed(isStorageDegraded()); }}
            >
              {t('action.retry')}
            </button>
          </div>
        ) : null}

        {!failed && shown.length === 0 ? (
          <div className="library__empty" data-testid="library-empty">
            <p className="library__empty-title">{t('library.emptyTitle')}</p>
            <p className="library__empty-body secondary">{t('library.emptyBody')}</p>
            <div className="library__empty-actions">
              <a className="button button--primary" href={href('bring')}>{t('action.bringRecording')}</a>
              <button type="button" className="button button--secondary" onClick={bringSampleBack}>
                {t('action.bringSampleBack')}
              </button>
            </div>
          </div>
        ) : null}

        {!failed && shown.length > 0 ? (
          <ul className="library__list" data-testid="library-list">
            {shown.map((interview) => (
              <li key={interview.id}>
                <Card
                  interview={interview}
                  notes={notes[interview.id] ?? []}
                  heardSec={transcripts[interview.id]?.heardSec ?? 0}
                  lede={interview.id === SAMPLE_ID && sampleUntouched ? t('library.lede') : null}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </main>

      {exportOpen ? (
        <ExportSheet
          interview={EXPORT_FIXTURE_INTERVIEW}
          notes={EXPORT_FIXTURE_NOTES}
          onClose={() => setExportOpen(false)}
          onCopied={toast.show}
        />
      ) : null}

      <Toast message={toast.message} onDone={toast.clear} />
    </>
  );
}

/* -------------------------------------------------------------------- card */

function Card({
  interview, notes, heardSec, lede,
}: { interview: Interview; notes: Note[]; heardSec: number; lede: string | null }) {
  const t = useT();
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    let live = true;
    void getCachedPeaks(interview.id).then((p) => { if (live) setPeaks(p); });
    return () => { live = false; };
  }, [interview.id]);
  const heard = notes.filter((n) => n.heard).length;
  const listening = interview.status === 'listening';
  const total = minutesOf(interview.durationSec);
  const done = Math.min(minutesOf(heardSec), total);
  const progress = total > 0 ? Math.min(1, done / total) : 0;

  return (
    <a className="card librarycard" href={href('interview', { id: interview.id })} data-interview={interview.id}>
      <h2 className="librarycard__title">{interview.title}</h2>

      {peaks ? <Waveform className="librarycard__wave" peaks={peaks} progress={progress} /> : null}

      <p className="librarycard__meta secondary">
        <span className="librarycard__date">
          {formatSheetDate(interview.recordedAt ?? interview.createdAt)}
        </span>
        <span className="librarycard__dot" aria-hidden="true">·</span>
        <span className="librarycard__duration tabular">{formatDuration(interview.durationSec)}</span>
      </p>

      {listening ? (
        <>
          <span className="librarycard__hairline" aria-hidden="true">
            <span className="librarycard__hairline-fill" style={{ transform: `scaleX(${progress})` }} />
          </span>
          <p className="librarycard__status secondary" data-testid="card-listening">
            {t('library.cardListening', { done, total })}
          </p>
        </>
      ) : (
        <p className="librarycard__status secondary" data-testid="card-status">
          {t('library.cardStatus', { notes: notes.length, heard })}
          {heard > 0 ? <span className="librarycard__check" aria-hidden="true"> ✓</span> : null}
        </p>
      )}

      {interview.sample ? <span className="librarycard__tag micro">{t('unit.sample')}</span> : null}
      {lede ? <p className="librarycard__lede secondary">{lede}</p> : null}
    </a>
  );
}
