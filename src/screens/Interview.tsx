/**
 * Interview `#/i/:id` — the product (DESIGN §4.2 and §5 in full).
 *
 * Everything on this screen exists to make one sentence true: press a line,
 * hear the second it was said. The notes are the claim, the chip is the
 * receipt, and the pause at the end of the span is the product telling you it
 * is done making its case so you can decide.
 *
 * The audio is WP1's: this screen never touches an `<audio>` element except to
 * hand the one element to `getPlayer().attach()`, and it reads playback state
 * from WP0's `usePlayer` store. The one seam left is Export, which raises a
 * `heard:export` event for WP3's ExportSheet rather than importing a module
 * WP2 does not own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Anchor, Note } from '../types';
import {
  selectInterview, selectNotes, selectTranscript, usePlayer, useStore,
} from '../store';
import { POST_ROLL_SEC } from '../store/presets';
import { getAudio, putAudio } from '../lib/storage';
import { ensurePeaks } from '../audio/peaks';
import { formatBytes, formatDuration, minutesOf } from '../lib/time';
import { useT } from '../i18n';
import { href, navigate } from '../router';
import { getPlayer } from '../audio/player';
import { maybeRunIntake } from '../audio/intake';
import { wordAt } from '../components/wordCursor';
import NoteRow from '../components/NoteRow';
import SelectionPill from '../components/SelectionPill';
import Player, { type SheetHeight } from '../components/Player';
import TranscriptParagraph, { buildParagraphs, type Paragraph } from '../components/TranscriptParagraph';
import './Interview.css';

const FIRST_RUN_KEY = 'heard-firstrun-line';
const AFTERGLOW_MS = 1600;
/** The transcript must not fight a user who is reading it (DESIGN §5, precision). */
const USER_SCROLL_GRACE_MS = 2000;

type Tab = 'notes' | 'transcript';
interface SelectionInfo { x: number; y: number; wi: number; wj: number; text: string }

export default function Interview({ id }: { id: string }) {
  const t = useT();
  const interview = useStore(selectInterview(id));
  const transcript = useStore(selectTranscript(id));
  const notes = useStore(selectNotes(id));
  const speed = useStore((s) => s.settings.ui.speed);

  /**
   * The `<audio>` node is tracked in state, not just a ref, because on a
   * reload the store hydrates from IndexedDB *after* the first render: this
   * screen renders its "interview not found" branch first, so the element
   * does not exist yet when a mount-time effect would look for it. Keying the
   * wiring on the node itself is what makes the audio survive a refresh —
   * without it, every reloaded interview came back with a silent player.
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const attachAudio = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
    setAudioEl(el);
  }, []);
  const player = useMemo(() => getPlayer(), []);
  const playback = usePlayer();

  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [tab, setTab] = useState<Tab>('notes');
  const [sheet, setSheet] = useState<SheetHeight>('collapsed');
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [afterglowId, setAfterglowId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [nudged, setNudged] = useState(false);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [firstRunDismissed, setFirstRunDismissed] = useState(
    () => { try { return localStorage.getItem(FIRST_RUN_KEY) === '1'; } catch { return false; } },
  );

  /* The element's own clock. WP1's rAF loop stops when audio stops, so while
     paused — mid-sentence, scrubbed, or stopped at the receipt — this is what
     the karaoke reads from. It is the same truth, sampled by event instead of
     by frame, and it costs nothing while the voice is running. */
  const [elTime, setElTime] = useState(0);
  useEffect(() => {
    if (!audioEl) return;
    const sync = () => setElTime(audioEl.currentTime);
    const events = ['seeked', 'timeupdate', 'pause', 'loadedmetadata'];
    for (const ev of events) audioEl.addEventListener(ev, sync);
    return () => { for (const ev of events) audioEl.removeEventListener(ev, sync); };
  }, [audioEl]);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const lastUserScrollRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const afterglowTimer = useRef<number>();

  const paragraphs = useMemo(() => buildParagraphs(transcript), [transcript]);

  /**
   * The cursor the DOM draws. While the voice is running this is WP1's
   * unthrottled rAF index — the only version that lands on the right frame.
   * While it is not (paused mid-sentence, scrubbed, stopped at the receipt),
   * the engine's loop is not running, so the same containment rule is applied
   * here to `currentTime` (components/wordCursor.ts).
   */
  const wordIndex = playback.playing
    ? playback.wordIndex
    : wordAt(transcript?.words ?? [], elTime);
  const pressedNote = useMemo(() => notes.find((n) => n.id === pressedId) ?? null, [notes, pressedId]);
  const spanWords = useMemo(
    () => (pressedNote ? { wi: pressedNote.anchor.wi, wj: pressedNote.anchor.wj } : undefined),
    [pressedNote],
  );

  /* ------------------------------------------------------------ the shell */

  // The route-level appbar belongs to the Library/Bring/Settings screens; this
  // screen has its own 56 px header and must own the whole viewport.
  useEffect(() => {
    document.documentElement.dataset.screen = 'interview';
    return () => { delete document.documentElement.dataset.screen; };
  }, []);

  useEffect(() => { useStore.getState().setCurrentInterview(id); }, [id]);

  /**
   * Everything below is *about one interview*, and React keeps this component
   * mounted across `#/i/a → #/i/b` because the element type and position never
   * change. Without this, opening a second interview inherits the first one's
   * segment, sheet height, pressed row and afterglow — which is how a screen
   * ends up showing another recording's player state over this one's notes.
   */
  useEffect(() => {
    setTab('notes');
    setSheet('collapsed');
    setPressedId(null);
    setAfterglowId(null);
    setFocusedId(null);
    setStopped(false);
    setNudged(false);
    setNotice(null);
    setSelection(null);
    setMenuOpen(false);
    setEditingTitle(false);
    setElTime(0);
  }, [id]);

  /* The headless driving surface for verify-interview.mjs and the screenshot
     set. `import.meta.env.DEV` folds to false in a production build, so Vite
     drops the import and the fixtures with it. */
  useEffect(() => {
    if (import.meta.env.DEV) void import('./Interview.devkit');
  }, []);

  /* ------------------------------------------------------------ the intake */

  /* v3 B2: opening an interview that still needs transcribing starts (or
     retries) the pipeline. Single-flight and no-op when there is nothing to
     do, so re-running on status flips costs nothing. */
  const ivStatus = useStore((s) => s.interviews[id]?.status);
  const sttKey = useStore((s) => s.settings.stt.key);
  useEffect(() => { maybeRunIntake(id); }, [id, ivStatus, sttKey]);

  /* ----------------------------------------------------------- the player */

  useEffect(() => { if (audioEl) player.attach(audioEl); }, [player, audioEl]);
  useEffect(() => { player.setSpeed(speed); }, [player, speed]);
  // The controller is a singleton for the whole app, so leaving this screen
  // stops the tape — it does not destroy the instrument.
  useEffect(() => () => player.pause(), [player]);

  /**
   * Point WP1's engine at this interview. `'missing'` is not an error — it is
   * the dashed-chip state, and the transcript still reads (§4.2, §5). The
   * words are re-sent whenever the transcript grows, which is what makes a
   * chip pressable the moment its chunk lands during the listening state.
   */
  const [audioEpoch, setAudioEpoch] = useState(0);
  useEffect(() => {
    // Never load before the element exists: the controller assigns `src` at
    // load time and will not revisit that decision for the same interview.
    if (!audioEl) return;
    let cancelled = false;
    void player.load(id, transcript?.words ?? []).then((result) => {
      if (!cancelled) setHasAudio(result === 'ok');
    });
    return () => { cancelled = true; };
  }, [player, id, transcript, audioEpoch, audioEl]);

  /* The shape of sound: one decode per recording, cached (peaks.ts), drawn by
     the player track. Failure to decode just leaves the plain line. */
  useEffect(() => {
    setPeaks(null);
    if (hasAudio !== true) return;
    let cancelled = false;
    void getAudio(id)
      .then((blob) => (blob ? ensurePeaks(id, blob) : null))
      .then((p) => { if (!cancelled) setPeaks(p); });
    return () => { cancelled = true; };
  }, [id, hasAudio, audioEpoch]);

  /* The receipt: the span reached `e + 0.8` and playback stopped by itself. */
  useEffect(() => {
    if (!playback.span || playback.playing) return;
    if (playback.currentTime < playback.span.e + POST_ROLL_SEC - 0.06) return;
    if (!pressedId) return;
    setStopped(true);
    setAfterglowId(pressedId);
    window.clearTimeout(afterglowTimer.current);
    afterglowTimer.current = window.setTimeout(() => setAfterglowId(null), AFTERGLOW_MS);
  }, [playback.playing, playback.currentTime, playback.span, pressedId]);

  /* -------------------------------------------------------------- pressing */

  const scrollToSpan = useCallback((anchor: Anchor) => {
    const pane = transcriptRef.current;
    if (!pane) return;
    if (Date.now() - lastUserScrollRef.current < USER_SCROLL_GRACE_MS) return;
    const wordIndex = anchor.wi ?? -1;
    const target = wordIndex >= 0
      ? pane.querySelector<HTMLElement>(`.w[data-i='${wordIndex}']`)?.closest<HTMLElement>('.tp')
      : [...pane.querySelectorAll<HTMLElement>('.tp')]
        .reverse()
        .find((p) => Number(p.dataset.start) <= anchor.s);
    if (!target) return;
    // The upper third, so the sentence has room to run underneath it (§5.3).
    const top = target.offsetTop - pane.clientHeight / 3;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pane.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  const press = useCallback((note: Note) => {
    setPressedId(note.id);
    setFocusedId(note.id);
    setStopped(false);
    setNudged(false);
    setNotice(null);
    setAfterglowId(null);
    if (!firstRunDismissed) dismissFirstRun();
    navigator.vibrate?.(8);
    if (hasAudio) {
      void player.playSpan(note.anchor);
      // On mobile the sheet comes up to mid rather than switching segments —
      // the user must never lose the note they just pressed (§5.3).
      if (window.innerWidth < 960 && tab === 'notes') setSheet('mid');
    }
    window.requestAnimationFrame(() => scrollToSpan(note.anchor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, hasAudio, scrollToSpan, tab, firstRunDismissed]);

  function dismissFirstRun() {
    setFirstRunDismissed(true);
    try { localStorage.setItem(FIRST_RUN_KEY, '1'); } catch { /* private mode */ }
  }

  /* ------------------------------------------------------------ selection */

  /**
   * Resolve a selection to a word range.
   *
   * By intersection rather than by walking up from `startContainer`: a real
   * drag routinely begins or ends on the whitespace *between* two word spans,
   * and a caret that lands on the paragraph element instead of a word would
   * silently produce no pill. Asking each word whether the range touches it is
   * the same question the user is actually asking with the mouse.
   */
  const readSelection = useCallback(() => {
    const pane = transcriptRef.current;
    const sel = window.getSelection();
    if (!pane || !sel || sel.isCollapsed || sel.rangeCount === 0) { setSelection(null); return; }
    const range = sel.getRangeAt(0);
    if (!pane.contains(range.commonAncestorContainer)
      && !range.intersectsNode(pane)) { setSelection(null); return; }

    const hits: number[] = [];
    for (const el of pane.querySelectorAll<HTMLElement>('.w')) {
      if (range.intersectsNode(el)) hits.push(Number(el.dataset.i));
    }
    if (!hits.length) { setSelection(null); return; }

    const rect = range.getBoundingClientRect();
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    setSelection({
      x: rect.width ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: Math.max(52, rect.top - 8),
      wi: Math.min(...hits),
      wj: Math.max(...hits) + 1,
      text,
    });
  }, []);

  useEffect(() => {
    const onUp = () => window.setTimeout(readSelection, 0);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('selectionchange', onUp);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('selectionchange', onUp);
    };
  }, [readSelection]);

  const selectionAnchor = useCallback((sel: SelectionInfo): Anchor | null => {
    const words = transcript?.words ?? [];
    const a = words.find((w) => w.i === sel.wi);
    const b = words.find((w) => w.i === sel.wj - 1);
    if (!a || !b) return null;
    return { s: a.s, e: b.e, wi: sel.wi, wj: sel.wj, quality: 'word' };
  }, [transcript]);

  function saveAsQuote() {
    if (!selection) return;
    const anchor = selectionAnchor(selection);
    if (!anchor) return;
    const note = useStore.getState().addNote(id, {
      kind: 'yours', text: selection.text, quote: selection.text, anchor,
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setFocusedId(note.id);
    if (window.innerWidth < 960) setTab('notes');
  }

  function playSelection() {
    if (!selection) return;
    const anchor = selectionAnchor(selection);
    if (!anchor || !hasAudio) return;
    setPressedId(null);
    setStopped(false);
    void player.playSpan(anchor);
    setSelection(null);
  }

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const list = notes;
      const idx = list.findIndex((n) => n.id === focusedId);
      switch (e.key) {
        case ' ':
          e.preventDefault(); player.toggle(); break;
        case 'ArrowLeft':
          e.preventDefault(); player.nudge(e.shiftKey ? -1 : -3); setNudged(true); break;
        case 'ArrowRight':
          e.preventDefault(); player.nudge(e.shiftKey ? 1 : 3); setNudged(true); break;
        case 'ArrowDown':
          e.preventDefault(); setFocusedId(list[Math.min(list.length - 1, idx + 1)]?.id ?? null); break;
        case 'ArrowUp':
          e.preventDefault(); setFocusedId(list[Math.max(0, idx - 1)]?.id ?? null); break;
        case 'Enter':
          if (idx >= 0) { e.preventDefault(); press(list[idx]); } break;
        case 'h': case 'H':
          if (idx >= 0) { e.preventDefault(); useStore.getState().toggleHeard(id, list[idx].id); } break;
        case 'Escape':
          setSelection(null);
          setSheet('collapsed');
          if (focusedId) {
            document.querySelector<HTMLElement>(`[data-note-id='${focusedId}'] .tc-hit`)?.focus();
          }
          break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, notes, focusedId, id, press]);

  /* ---------------------------------------------------------- header verbs */

  function commitTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (next && interview && next !== interview.title) {
      useStore.getState().updateInterview(id, { title: next });
    }
  }

  function onLocateFile(file: File) {
    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.src = URL.createObjectURL(file);
    probe.addEventListener('loadedmetadata', () => {
      const found = probe.duration;
      URL.revokeObjectURL(probe.src);
      const expected = interview?.durationSec ?? 0;
      // ±1.0 s is the identity test (§4.2): same length, same recording.
      if (expected && Math.abs(found - expected) > 1.0) {
        setNotice(t('interview.wrongFile', {
          found: formatDuration(found), expected: formatDuration(expected),
        }));
        return;
      }
      void (async () => {
        await putAudio(id, file);
        if (interview) useStore.getState().updateInterview(id, { file: { ...interview.file, kept: true } });
        setNotice(null);
        setAudioEpoch((n) => n + 1);
      })();
    });
    probe.addEventListener('error', () => {
      setNotice(t('interview.wrongFile', { found: '—', expected: formatDuration(interview?.durationSec ?? 0) }));
    });
  }

  /* ------------------------------------------------------------- rendering */

  if (!interview) {
    // A hash pointing at an interview that is gone is a Library, never a blank.
    return (
      <main className="iv iv--gone">
        <p className="secondary">{t('library.emptyTitle')}</p>
        <a className="btn btn--secondary" href={href('library')}>{t('action.back')}</a>
      </main>
    );
  }

  const listening = interview.status === 'listening';
  const reading = interview.status === 'reading';
  const partial = interview.status === 'partial';
  const waiting = interview.status === 'waiting';
  const noTranscript = !transcript || transcript.words.length === 0;
  const heardSec = transcript?.heardSec ?? 0;
  const audioMissing = hasAudio === false;
  const chipAudio = hasAudio !== false;

  const points = notes.filter((n) => n.kind === 'point');
  const quotable = notes.filter((n) => n.kind === 'quote');
  const yours = notes.filter((n) => n.kind === 'yours');
  const heardCount = notes.filter((n) => n.heard).length;

  const contextLang = interview.lang === 'auto' ? (transcript?.lang ?? '—') : interview.lang;
  const contextDate = new Date(interview.recordedAt ?? interview.createdAt).toISOString().slice(0, 10);
  const contextStrip = waiting
    ? t('interview.waiting')
    : listening
    ? t('interview.listening', { done: minutesOf(heardSec), total: minutesOf(interview.durationSec) })
    : reading
      ? t('interview.readingBack')
      : partial
        ? t('interview.heardOfMin', { done: minutesOf(heardSec), total: minutesOf(interview.durationSec) })
        : t('interview.contextStrip', {
          duration: formatDuration(interview.durationSec), date: contextDate, lang: contextLang,
        });

  const failedChunks = (transcript?.chunks ?? []).filter((c) => c.state === 'failed');
  const tcWidth = interview.durationSec >= 3600 ? '7ch' : '5ch';

  function renderParagraph(p: Paragraph) {
    const first = p.words[0].i;
    const last = p.words[p.words.length - 1].i;
    const holdsCursor = wordIndex >= first && wordIndex <= last;
    const touchesSpan = spanWords?.wi != null && spanWords.wj != null
      && spanWords.wj > first && spanWords.wi <= last;
    return (
      <TranscriptParagraph
        key={p.i}
        para={p}
        wordIndex={holdsCursor || touchesSpan ? wordIndex : -1}
        span={touchesSpan ? spanWords : undefined}
        staticSpan={audioMissing && touchesSpan ? spanWords : undefined}
      />
    );
  }

  const currentParagraph = paragraphs.find(
    (p) => wordIndex >= p.words[0].i && wordIndex <= p.words[p.words.length - 1].i,
  ) ?? (pressedNote
    ? paragraphs.find((p) => p.e >= pressedNote.anchor.s && p.s <= pressedNote.anchor.e)
    : undefined);

  const notesPane = (
    <section className="iv__pane iv__notes" data-testid="notes-pane" style={{ ['--tc-width' as string]: tcWidth }}>
      {interview.sample && !firstRunDismissed ? (
        <div className="iv__firstrun" data-testid="first-run">
          <p className="iv__firstrun-line">{t('interview.firstRun')}</p>
          <button type="button" className="iconbtn" aria-label={t('action.close')} onClick={dismissFirstRun}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      {notice ? <p className="card-note" data-testid="notice">{notice}</p> : null}

      {waiting ? (
        <div className="iv__pending card-note" data-testid="notes-waiting">
          <p>{t('interview.waitingBody')}</p>
          <a className="button button--secondary" href={href('bring')}>{t('interview.waitingCta')}</a>
        </div>
      ) : null}
      {listening ? (
        <p className="iv__pending card-note" data-testid="notes-pending">{t('interview.notesPending')}</p>
      ) : null}
      {reading ? (
        <p className="iv__pending card-note" data-testid="reading-back">{t('interview.readingBack')}</p>
      ) : null}

      {!listening && !reading ? (
        <div className="iv__sections" data-testid="note-sections">
          {[
            { key: 'point', label: t('interview.sectionPoints'), rows: points },
            { key: 'quote', label: t('interview.sectionQuotable'), rows: quotable },
            { key: 'yours', label: t('interview.sectionYours'), rows: yours },
          ].filter((s) => s.rows.length > 0).map((section) => (
            <div className="iv__section" key={section.key} data-section={section.key}>
              <h2 className="micro iv__sectionlabel">{section.label}</h2>
              {section.rows.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  hasAudio={chipAudio}
                  playing={pressedId === note.id && playback.playing}
                  afterglow={afterglowId === note.id}
                  focused={focusedId === note.id}
                  onPress={press}
                  onFocus={(n) => setFocusedId(n.id)}
                  onToggleHeard={(n) => useStore.getState().toggleHeard(id, n.id)}
                  onEdit={note.kind === 'yours'
                    ? (n, text) => useStore.getState().updateNote(id, n.id, { text })
                    : undefined}
                  onDelete={(n) => useStore.getState().deleteNote(id, n.id)}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <p className="iv__hint micro" data-testid="select-hint">{t('interview.selectHint')}</p>
    </section>
  );

  const transcriptPane = (
    <section className="iv__pane iv__transcript" data-testid="transcript-pane">
      <div
        className="iv__transcript-scroll"
        ref={transcriptRef}
        onScroll={() => { lastUserScrollRef.current = Date.now(); }}
      >
        {noTranscript ? (
          <div className="card-note iv__empty" data-testid="not-heard">
            <p className="iv__empty-title">{t('interview.notHeardTitle')}</p>
            <p className="secondary">{interview.file.name} · {formatBytes(interview.file.size)}</p>
            <button type="button" className="btn btn--secondary">{t('action.listenOnce')}</button>
          </div>
        ) : (
          <div className="iv__reading">
            {paragraphs.map((p, k) => {
              const gap = failedChunks.find(
                (c) => c.s >= p.e && (k === paragraphs.length - 1 || c.s < paragraphs[k + 1].s),
              );
              return (
                <div key={p.i}>
                  {renderParagraph(p)}
                  {gap ? (
                    <div className="card-note iv__gap" data-testid="gap-card">
                      <p className="iv__empty-title">
                        {t('interview.gapTitle', { from: Math.floor(gap.s / 60), to: minutesOf(gap.e) })}
                      </p>
                      <button type="button" className="btn btn--secondary">{t('action.tryAgain')}</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <main className="iv" data-screen="interview" data-interview-id={id} data-status={interview.status}>
      <header className="iv__header">
        <a className="iconbtn iv__back" href={href('library')} aria-label={t('action.back')}>
          <span aria-hidden="true">←</span>
        </a>

        {editingTitle ? (
          <input
            className="iv__title-edit"
            data-testid="title-edit"
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); }
            }}
          />
        ) : (
          <button
            type="button"
            className="iv__title"
            data-testid="title"
            onClick={() => { setTitleDraft(interview.title); setEditingTitle(true); }}
          >
            {interview.title}
          </button>
        )}

        <button
          type="button"
          className="iconbtn"
          data-testid="export"
          aria-label={t('action.export')}
          /* WP3 owns the sheet; WP2 owns the button. An event is the seam. */
          onClick={() => window.dispatchEvent(new CustomEvent('heard:export', { detail: { id } }))}
        >
          <span className="icon-export" aria-hidden="true" />
        </button>

        <div className="iv__headermenu">
          <button
            type="button"
            className="iconbtn"
            data-testid="more"
            aria-label={t('action.more')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span aria-hidden="true">⋯</span>
          </button>
          {menuOpen ? (
            <div className="menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button type="button" role="menuitem" className="menu__item"
                onClick={() => { setMenuOpen(false); setTitleDraft(interview.title); setEditingTitle(true); }}>
                {t('action.rename')}
              </button>
              <button type="button" role="menuitem" className="menu__item"
                onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }}>
                {t('action.locateFile')}
              </button>
              <button type="button" role="menuitem" className="menu__item"
                onClick={() => {
                  setMenuOpen(false);
                  if (window.confirm(t('interview.deleteConfirm'))) {
                    useStore.getState().deleteInterview(id);
                    navigate('library');
                  }
                }}>
                {t('action.delete')}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {/* The progress hairline under the header, for the normal slow state. */}
      {listening || reading ? (
        <div className="iv__progress" data-testid="progress-hairline">
          <span
            className="iv__progress-fill"
            style={{ width: `${interview.durationSec ? (heardSec / interview.durationSec) * 100 : 0}%` }}
          />
        </div>
      ) : null}

      {/* One line about the whole interview, so it survives the mobile
          segmented control: on a phone the panes are exclusive, and a
          "Listening… 23 of 92 min" that lived inside the Notes pane would
          disappear exactly when the user opened the transcript it describes. */}
      <p className="iv__context secondary" data-testid="context-strip">{contextStrip}</p>

      <div className="iv__segmented" role="tablist" data-testid="segmented">
        <button
          type="button" role="tab" className="seg" data-on={tab === 'notes'}
          data-testid="tab-notes" aria-selected={tab === 'notes'}
          onClick={() => setTab('notes')}
        >
          {t('interview.tabNotesCount', { n: notes.length })}
        </button>
        <button
          type="button" role="tab" className="seg" data-on={tab === 'transcript'}
          data-testid="tab-transcript" aria-selected={tab === 'transcript'}
          onClick={() => setTab('transcript')}
        >
          {t('interview.tabTranscript')}
        </button>
      </div>

      <div className="iv__body" data-tab={tab}>
        {notesPane}
        {transcriptPane}
      </div>

      <Player
        snap={{ ...playback, wordIndex, speed }}
        peaks={peaks}
        hasAudio={!audioMissing}
        durationSec={interview.durationSec}
        stopped={stopped}
        nudged={nudged}
        notice={notice}
        height={sheet}
        onHeight={setSheet}
        onToggle={() => player.toggle()}
        onSeek={(s) => player.seek(s)}
        onNudge={(d) => { player.nudge(d); setNudged(true); }}
        onKeepListening={() => { setStopped(false); player.keepListening(); }}
        onPlayAgain={() => { setStopped(false); void player.playAgain(); }}
        onSpeed={(rate) => useStore.getState().setSettings({ ui: { speed: rate } })}
        onPin={() => {
          if (!pressedNote) return;
          const s = player.currentTime();
          const len = Math.max(0.5, pressedNote.anchor.e - pressedNote.anchor.s);
          useStore.getState().pinNote(id, pressedNote.id, {
            ...pressedNote.anchor, s, e: s + len, quality: 'word',
          });
          setNudged(false);
        }}
        onLocate={() => fileInputRef.current?.click()}
        onBackToNote={() => {
          setSheet('collapsed');
          setTab('notes');
          if (pressedId) {
            document.querySelector<HTMLElement>(`[data-note-id='${pressedId}']`)
              ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }}
        currentParagraph={currentParagraph ? renderParagraph(currentParagraph) : null}
        fullTranscript={paragraphs.map(renderParagraph)}
      />

      {selection ? (
        <SelectionPill
          x={selection.x}
          y={selection.y}
          canPlay={!audioMissing}
          onSave={saveAsQuote}
          onPlay={playSelection}
        />
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/mp4"
        className="sr-only"
        data-testid="locate-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onLocateFile(f); e.target.value = ''; }}
      />

      {/* One <audio> for the whole app (§5). */}
      <audio ref={attachAudio} data-testid="audio" preload="metadata" />

      <span className="sr-only" data-testid="heard-count">{t('unit.heardCount', { n: heardCount })}</span>
    </main>
  );
}
