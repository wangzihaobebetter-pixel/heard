/**
 * SelectionPill — DESIGN §4.2: "Selecting text raises a floating pill: Save as
 * quote · Play."
 *
 * It is the second thing a new user does (§6 moment 1), so it must appear
 * without being asked for and disappear without being dismissed.
 */
import './SelectionPill.css';
import { useT } from '../i18n';

export interface SelectionPillProps {
  x: number;
  y: number;
  onSave: () => void;
  onPlay: () => void;
  canPlay: boolean;
}

export default function SelectionPill({ x, y, onSave, onPlay, canPlay }: SelectionPillProps) {
  const t = useT();
  return (
    <div
      className="pill"
      data-testid="selection-pill"
      role="group"
      style={{ left: `${x}px`, top: `${y}px` }}
      // The pill must not steal the selection it exists to act on.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className="pill__btn" data-testid="save-as-quote" onClick={onSave}>
        {t('action.saveAsQuote')}
      </button>
      {canPlay ? (
        <>
          <span className="pill__sep" aria-hidden="true" />
          <button type="button" className="pill__btn" data-testid="play-selection" onClick={onPlay}>
            {t('action.play')}
          </button>
        </>
      ) : null}
    </div>
  );
}
