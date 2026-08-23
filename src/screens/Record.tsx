/**
 * Record `#/rec` (v3 B2, PRODUCT-SPEC §4.1). The product's core verb.
 *
 * Apple is the feel benchmark: recording starts on the first touch — no
 * dialog, no settings, no step 2. Everything else on the screen exists to
 * answer two questions during a lecture:
 *
 *   "is it actually recording?"  — the live meter, drawn from the mic, plus
 *                                  the silence warning when input is dead for
 *                                  20 s (Good Tape's insight: discover a dead
 *                                  mic during the session, not after it)
 *   "can I capture this moment?" — Mark pins the current second in one tap;
 *                                  the live note field anchors to the moment
 *                                  typing BEGAN, because that is when the
 *                                  thought happened
 *
 * Leaving the screen does not stop the tape (the controller is a singleton;
 * App renders a compact return bar) and neither does a crash (recorder.ts
 * persists slices as they exist).
 */
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { href, replace } from '../router';
import { formatDuration } from '../lib/time';
import { getRecorder, useRecorder, LEVELS_KEPT, type RecorderDenial } from '../audio/recorder';
import '../components/ui.css';
import './Record.css';

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** The live meter: recent RMS frames as bars, newest at the right edge. */
function LiveWave({ levels, paused }: { levels: number[]; paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const live = cssVar(canvas, '--anchor') || '#FF6B35';
    const idle = cssVar(canvas, '--ink-3') || '#837A6C';

    // Normalise against the loudest recent frame so a quiet room still draws
    // a legible shape — same trick as the playback peaks (audio/peaks.ts).
    let peak = 0;
    for (const v of levels) if (v > peak) peak = v;
    const scale = peak > 0.001 ? 1 / peak : 0;

    const gap = 2;
    const bw = Math.max(2, (w - gap * (LEVELS_KEPT - 1)) / LEVELS_KEPT);
    const step = bw + gap;
    const mid = h / 2;
    const offset = LEVELS_KEPT - levels.length;
    ctx.fillStyle = paused ? idle : live;
    for (let i = 0; i < levels.length; i++) {
      const v = Math.min(1, levels[i] * scale);
      const bh = Math.max(2, (0.08 + 0.92 * Math.pow(v, 1.25)) * (h - 2));
      const x = (offset + i) * step;
      const r = Math.min(bw / 2, 1.5);
      ctx.globalAlpha = paused ? 0.5 : 0.35 + 0.65 * (i / Math.max(1, levels.length - 1));
      ctx.beginPath();
      ctx.roundRect(x, mid - bh / 2, bw, bh, r);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [levels, paused]);

  return <canvas ref={ref} className="record__wave" aria-hidden="true" />;
}

export default function Record() {
  const t = useT();
  const rec = useRecorder();
  const recorder = getRecorder();
  const [refusal, setRefusal] = useState<RecorderDenial | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState('');
  /** elapsed seconds when the current draft's FIRST character landed */
  const draftStartRef = useRef<number | null>(null);

  const idle = rec.phase === 'idle';
  const paused = rec.phase === 'paused';
  const stopping = rec.phase === 'stopping';

  async function start() {
    setRefusal(null);
    const result = await recorder.start();
    if (result !== 'ok') setRefusal(result);
  }

  async function done() {
    const interviewId = await recorder.stop();
    // Land inside the new recording, like Bring does; Back should not return
    // to a dead capture surface.
    if (interviewId) replace('interview', { id: interviewId });
  }

  async function discard() {
    setConfirming(false);
    await recorder.discard();
  }

  function onDraft(next: string) {
    if (next && draftStartRef.current == null) draftStartRef.current = recorder.elapsed();
    if (!next) draftStartRef.current = null;
    setDraft(next);
  }

  function addNote() {
    const at = draftStartRef.current ?? recorder.elapsed();
    recorder.addLiveNote(draft, at);
    setDraft('');
    draftStartRef.current = null;
  }

  return (
    <>
      <header className="topbar">
        <a className="topbar__name" href={href('library')}>{t('app.name')}</a>
        <span className="topbar__spacer" />
        <a className="iconbutton" href={href('settings')} aria-label={t('settings.title')}>⚙</a>
      </header>

      <main className="screen record" data-screen="record" data-phase={rec.phase}>
        <h1 className="screen__title">{t('record.title')}</h1>

        {refusal ? (
          <div className="notice" data-testid="record-refusal">
            <p className="notice__text">{refusal === 'denied' ? t('record.denied') : t('record.unavailable')}</p>
          </div>
        ) : null}

        {idle ? (
          <div className="record__idle">
            <button
              type="button"
              className="record__big"
              data-testid="record-start"
              onClick={() => { void start(); }}
              aria-label={t('record.start')}
            >
              <span className="record__big-dot" aria-hidden="true" />
            </button>
            <p className="record__cta">{t('record.start')}</p>
            <p className="record__privacy secondary">{t('record.privacy')}</p>
          </div>
        ) : (
          <div className="record__live">
            <LiveWave levels={rec.levels} paused={paused} />

            <p className="record__clock tabular" data-testid="record-elapsed">
              {formatDuration(rec.elapsedSec)}
            </p>
            <p className="record__state secondary" data-testid="record-state">
              {paused ? t('record.paused') : t('record.recording')}
            </p>

            {rec.silent && !paused ? (
              <div className="notice record__silent" data-testid="record-silent">
                <p className="notice__text">{t('record.silenceWarn')}</p>
              </div>
            ) : null}

            <div className="record__controls">
              <button
                type="button"
                className="button button--secondary"
                data-testid="record-pause"
                disabled={stopping}
                onClick={() => (paused ? recorder.resume() : recorder.pause())}
              >
                {paused ? t('record.resume') : t('record.pause')}
              </button>
              <button
                type="button"
                className="button button--secondary record__mark"
                data-testid="record-mark"
                disabled={stopping}
                onClick={() => recorder.mark()}
              >
                {t('record.mark')}{rec.markCount > 0 ? <span className="record__markcount tabular"> {rec.markCount}</span> : null}
              </button>
              <button
                type="button"
                className="button button--primary"
                data-testid="record-done"
                disabled={stopping}
                onClick={() => { void done(); }}
              >
                {t('record.done')}
              </button>
            </div>

            <div className="record__note">
              <input
                className="input"
                data-testid="record-note"
                type="text"
                placeholder={t('record.notePlaceholder')}
                value={draft}
                disabled={stopping}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) addNote(); }}
              />
              <button
                type="button"
                className="button button--quiet"
                data-testid="record-note-add"
                disabled={!draft.trim() || stopping}
                onClick={addNote}
              >
                {t('record.noteAdd')}
              </button>
            </div>
            {rec.noteCount > 0 ? (
              <p className="record__notecount secondary">{t('record.noteCount', { n: rec.noteCount })}</p>
            ) : null}

            <div className="record__discard">
              {!confirming ? (
                <button type="button" className="button button--quiet" data-testid="record-discard" disabled={stopping} onClick={() => setConfirming(true)}>
                  {t('record.discard')}
                </button>
              ) : (
                <div className="record__confirm" data-testid="record-confirm">
                  <span className="secondary">{t('record.discardAsk')}</span>
                  <button type="button" className="button button--quiet" onClick={() => { void discard(); }}>{t('record.discardYes')}</button>
                  <button type="button" className="button button--secondary" onClick={() => setConfirming(false)}>{t('record.discardNo')}</button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
