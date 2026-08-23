/**
 * Player — one <audio> for the whole app, presented as a bottom sheet on
 * mobile and a fixed bar on desktop (DESIGN §5 "The player").
 *
 * The three sheet heights are not decoration. Collapsed (88 px) is the resting
 * state. Mid (42 vh) is what a chip press raises on mobile, because §5.3 says
 * the user must never lose the note they pressed — so the words come to the
 * player rather than the user going to the transcript. Full is the transcript
 * itself, and only then does the "back to note" pill appear.
 *
 * The nudge cluster and "Pin here" are the honesty mechanism for a timestamp
 * that is off by a second or two: the app cannot hear, so the human corrects
 * it and the correction sticks (`pinnedByUser`).
 */
import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '../types';
import { NUDGES, SPEEDS } from '../store/presets';
import { formatTimecode, formatTimecodeTenths } from '../lib/time';
import { useT } from '../i18n';
import './Player.css';

export type SheetHeight = 'collapsed' | 'mid' | 'full';

/** What the player needs to draw itself: WP0's PlayerState plus the two
    things that state does not carry — the recording's length and the rate. */
export interface PlayerView extends PlayerState {
  speed: number;
}

export interface PlayerProps {
  snap: PlayerView;
  hasAudio: boolean;
  /** total length of the recording — known from the interview even with no blob */
  durationSec: number;
  /** the span stopped at its post-roll; offer Keep listening / Play again */
  stopped: boolean;
  /** a nudge has moved the playhead, so "Pin here" is meaningful */
  nudged: boolean;
  /** one honest line — e.g. the located file is a different recording (§4.2) */
  notice?: string | null;
  height: SheetHeight;
  onHeight: (h: SheetHeight) => void;
  onToggle: () => void;
  onSeek: (sec: number) => void;
  onNudge: (delta: number) => void;
  onKeepListening: () => void;
  onPlayAgain: () => void;
  onSpeed: (rate: number) => void;
  onPin: () => void;
  onLocate: () => void;
  onBackToNote: () => void;
  /** the paragraph under the voice right now, rendered by the screen */
  currentParagraph?: React.ReactNode;
  /** the full transcript, for the sheet at full height */
  fullTranscript?: React.ReactNode;
}

export default function Player(props: PlayerProps) {
  const {
    snap, hasAudio, durationSec, stopped, nudged, notice, height, onHeight,
    onToggle, onSeek, onNudge, onKeepListening, onPlayAgain, onSpeed, onPin,
    onLocate, onBackToNote, currentParagraph, fullTranscript,
  } = props;
  const t = useT();
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const total = durationSec || 0;
  const at = scrubbing ? scrubValue : snap.currentTime;
  const dragRef = useRef<{ y: number; from: SheetHeight } | null>(null);

  // Tenths while seeking, integers at rest (§5). The readout is a different
  // instrument in each mode and pretending otherwise makes it jitter.
  const readout = scrubbing ? formatTimecodeTenths(at) : formatTimecode(at);

  useEffect(() => { if (!scrubbing) setScrubValue(snap.currentTime); }, [snap.currentTime, scrubbing]);

  const spanLeft = snap.span && total ? (snap.span.s / total) * 100 : 0;
  const spanWidth = snap.span && total ? Math.max(1.2, ((snap.span.e - snap.span.s) / total) * 100) : 0;
  const progress = total ? (at / total) * 100 : 0;

  /* Drag the grabber between the three heights. A 40 px throw is enough to be
     deliberate and short enough to be one thumb movement. */
  function onGrabberDown(e: React.PointerEvent) {
    dragRef.current = { y: e.clientY, from: height };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onGrabberMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (dy > 40) { onHeight(d.from === 'collapsed' ? 'mid' : 'full'); dragRef.current = null; }
    else if (dy < -40) { onHeight(d.from === 'full' ? 'mid' : 'collapsed'); dragRef.current = null; }
  }
  function onGrabberUp() { dragRef.current = null; }

  return (
    <div className="player" data-testid="player" data-height={height} data-has-audio={hasAudio ? 'true' : 'false'}>
      {height === 'full' ? (
        <button type="button" className="player__backtonote" data-testid="back-to-note" onClick={onBackToNote}>
          ↩ {t('action.backToNote')}
        </button>
      ) : null}

      <button
        type="button"
        className="player__grabber"
        aria-label={t('interview.title')}
        data-testid="player-grabber"
        onPointerDown={onGrabberDown}
        onPointerMove={onGrabberMove}
        onPointerUp={onGrabberUp}
        onClick={() => onHeight(height === 'collapsed' ? 'mid' : height === 'mid' ? 'full' : 'collapsed')}
      >
        <span className="player__grabber-line" aria-hidden="true" />
      </button>

      {!hasAudio ? (
        /* Not an error — a state. Ink on surface-2 with an accent hairline (§7):
           no red anywhere in this product. */
        <div className="player__missing card-note" data-testid="audio-missing">
          <p className="player__missing-line">{notice ?? t('interview.audioMissing')}</p>
          <button type="button" className="btn btn--secondary" data-testid="locate-file" onClick={onLocate}>
            {t('action.locateFile')}
          </button>
        </div>
      ) : (
        <>
          <div className="player__row">
            <button
              type="button"
              className="player__play"
              data-testid="play-toggle"
              aria-label={snap.playing ? t('action.pause') : t('action.play')}
              onClick={onToggle}
            >
              {snap.playing
                ? <span className="icon-pause" aria-hidden="true" />
                : <span className="icon-play" aria-hidden="true" />}
            </button>

            <span className="player__time timecode" data-testid="player-time">{readout}</span>

            <div className="player__track" data-testid="player-track">
              <span className="player__track-line" aria-hidden="true" />
              {snap.span ? (
                <span
                  className="player__span"
                  data-testid="player-span"
                  aria-hidden="true"
                  style={{ left: `${spanLeft}%`, width: `${spanWidth}%` }}
                />
              ) : null}
              <span className="player__played" aria-hidden="true" style={{ width: `${progress}%` }} />
              <input
                type="range"
                className="player__range"
                aria-label={t('interview.title')}
                min={0}
                max={Math.max(1, total)}
                step={0.1}
                value={at}
                onPointerDown={() => setScrubbing(true)}
                onPointerUp={() => { setScrubbing(false); onSeek(scrubValue); }}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setScrubValue(v);
                  if (!scrubbing) onSeek(v);
                }}
              />
            </div>

            <span className="player__total timecode">{formatTimecode(total)}</span>

            <button
              type="button"
              className="player__speed"
              data-testid="speed"
              aria-label={t('interview.speed')}
              onClick={() => onSpeed(SPEEDS[(SPEEDS.indexOf(snap.speed as 1) + 1) % SPEEDS.length])}
            >
              {snap.speed}×
            </button>
          </div>

          {/* After a span stops, the two questions the user actually has, and
              the nudge cluster for when the tape and the note disagree (§5.5). */}
          <div className="player__after" data-testid="player-after" data-shown={stopped ? 'true' : 'false'}>
            <button type="button" className="btn btn--quiet" data-testid="keep-listening" onClick={onKeepListening}>
              {t('action.keepListening')}
            </button>
            <button type="button" className="btn btn--quiet" data-testid="play-again" onClick={onPlayAgain}>
              {t('action.playAgain')}
            </button>
            <span className="player__nudge-label micro">{t('interview.nudge')}</span>
            <span className="player__nudges">
              {NUDGES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="nudge timecode"
                  data-testid={`nudge${d}`}
                  onClick={() => onNudge(d)}
                >
                  {d > 0 ? `+${d}s` : `${d}s`}
                </button>
              ))}
            </span>
            {nudged ? (
              <button type="button" className="btn btn--quiet player__pin" data-testid="pin-here" onClick={onPin}>
                {t('action.pinHere')}
              </button>
            ) : null}
          </div>
        </>
      )}

      {height === 'mid' ? (
        <div className="player__para" data-testid="player-paragraph">{currentParagraph}</div>
      ) : null}
      {height === 'full' ? (
        <div className="player__full" data-testid="player-full">{fullTranscript}</div>
      ) : null}
    </div>
  );
}
