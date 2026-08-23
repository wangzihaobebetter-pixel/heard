/**
 * TranscriptParagraph — the tape, written down (DESIGN §4.2, §5.4).
 *
 * Every word is its own span so two things become possible that a blob of text
 * cannot do: the karaoke highlight can move word by word with the voice, and a
 * selection can be resolved back to a word range and therefore to a second on
 * the tape. That is the whole reason for the DOM cost.
 *
 * Paragraphs break on a silence of ≥ 2.5 s — the speaker's own punctuation,
 * which is more honest than the model's.
 */
import { memo } from 'react';
import type { Transcript, Word } from '../types';
import { formatTimecode } from '../lib/time';
import './TranscriptParagraph.css';

export const PARAGRAPH_GAP_SEC = 2.5;

export interface Paragraph {
  i: number;
  s: number;
  e: number;
  words: Word[];
}

/** Group words into paragraphs on the ≥ 2.5 s silence rule (DESIGN §4.2). */
export function buildParagraphs(t: Transcript | undefined | null): Paragraph[] {
  const words = t?.words ?? [];
  if (!words.length) return [];
  const out: Paragraph[] = [];
  let current: Word[] = [words[0]];
  for (let k = 1; k < words.length; k++) {
    const gap = words[k].s - words[k - 1].e;
    if (gap >= PARAGRAPH_GAP_SEC) {
      out.push({ i: out.length, s: current[0].s, e: current[current.length - 1].e, words: current });
      current = [];
    }
    current.push(words[k]);
  }
  if (current.length) {
    out.push({ i: out.length, s: current[0].s, e: current[current.length - 1].e, words: current });
  }
  return out;
}

export interface TranscriptParagraphProps {
  para: Paragraph;
  /** index of the word being spoken right now, or -1 */
  wordIndex: number;
  /** the span that was pressed, so already-spoken words inside it stay washed */
  span?: { wi?: number; wj?: number };
  /** the pressed span, statically highlighted when there is no audio to play */
  staticSpan?: { wi?: number; wj?: number };
}

function TranscriptParagraphImpl({ para, wordIndex, span, staticSpan }: TranscriptParagraphProps) {
  const first = para.words[0].i;
  const last = para.words[para.words.length - 1].i;
  // The cursor, not the transport, decides the highlight: pause mid-sentence
  // and the word you stopped on stays lit, because that is where you are.
  const isCurrent = wordIndex >= first && wordIndex <= last;

  return (
    <p
      className="tp"
      data-testid="transcript-paragraph"
      data-para={para.i}
      data-start={para.s}
      data-current={isCurrent ? 'true' : 'false'}
    >
      <span className="tp__bar" aria-hidden="true" />
      <span className="tp__gutter timecode" aria-hidden="true">{formatTimecode(para.s)}</span>
      <span className="tp__body">
        {para.words.map((w) => {
          const inSpan = span?.wi != null && span.wj != null && w.i >= span.wi && w.i < span.wj;
          const inStatic = staticSpan?.wi != null && staticSpan.wj != null && w.i >= staticSpan.wi && w.i < staticSpan.wj;
          const now = w.i === wordIndex;
          // Already spoken, inside the span the user pressed — the lighter wash.
          const said = inSpan && wordIndex > w.i;
          return (
            <span
              key={w.i}
              className="w"
              data-testid="word"
              data-i={w.i}
              data-s={w.s}
              data-e={w.e}
              data-now={now ? 'true' : 'false'}
              data-said={said || inStatic ? 'true' : 'false'}
            >
              {w.t}{' '}
            </span>
          );
        })}
      </span>
    </p>
  );
}

export default memo(TranscriptParagraphImpl);
