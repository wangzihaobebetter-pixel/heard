/**
 * TimecodeChip — "a button that is a fact" (DESIGN §5, §7).
 *
 * Five states, and every one of them is a claim about how much we know:
 *   rest     — aligned to a word span. Solid hairline.
 *   hover    — border darkens, a play triangle fades in, the chip widens 14 px.
 *   pressed  — accent fill, paper text. This is the moment.
 *   approx   — dotted border, muted ink, `≈` prefix. Segment-only or unaligned.
 *   dashed   — the recording isn't on this device. Pressing still scrolls.
 *
 * The digits are tabular mono at a fixed `ch` width so a column of chips lines
 * up to the pixel — §7 names that as one of the four things that make this feel
 * made rather than assembled.
 */
import type { Anchor } from '../types';
import { formatTimecode } from '../lib/time';
import './TimecodeChip.css';

export interface TimecodeChipProps {
  anchor: Anchor;
  /** false when the audio blob is gone — every chip on the screen goes dashed */
  hasAudio: boolean;
  /** the chip whose span is playing right now */
  pressed?: boolean;
  onPress?: () => void;
  label?: string;
}

/**
 * `≈ 14:3x` — DESIGN §4.2 spells the unaligned chip with an `x` in the units
 * place. It is not decoration: we know the minute, we do not know the second,
 * and the chip says exactly that much and no more.
 */
export function chipText(anchor: Anchor): string {
  const base = formatTimecode(anchor.s);
  if (anchor.quality === 'unpinned') return `≈ ${base.slice(0, -1)}x`;
  if (anchor.quality === 'segment') return `≈ ${base}`;
  return base;
}

export default function TimecodeChip({ anchor, hasAudio, pressed, onPress, label }: TimecodeChipProps) {
  const approx = anchor.quality !== 'word';
  const dashed = !hasAudio;
  return (
    <button
      type="button"
      className="tc-hit"
      data-testid="timecode-chip"
      data-quality={anchor.quality}
      data-approx={approx ? 'true' : 'false'}
      data-dashed={dashed ? 'true' : 'false'}
      data-pressed={pressed ? 'true' : 'false'}
      data-start={anchor.s}
      aria-label={label ?? chipText(anchor)}
      onClick={(e) => { e.stopPropagation(); onPress?.(); }}
    >
      <span className="tc" data-approx={approx ? 'true' : 'false'} data-dashed={dashed ? 'true' : 'false'} data-pressed={pressed ? 'true' : 'false'}>
        <span className="tc__tri" aria-hidden="true" />
        <span className="tc__t timecode">{chipText(anchor)}</span>
      </span>
    </button>
  );
}
