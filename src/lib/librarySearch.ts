/**
 * Global search — titles, transcript bodies, notes (v3 B6, PRODUCT-SPEC §4.5).
 *
 * Same folding as the in-transcript search (B4): the query matches what was
 * SAID, not how the transcriber punctuated it. Every hit carries the second
 * it points at, because a result you cannot jump to is a result you still
 * have to go find.
 */
import type { Interview, Note, Transcript } from '../types';
import { findMatches, foldToken } from './transcriptEdit';

export interface SearchHit {
  interviewId: string;
  title: string;
  kind: 'title' | 'transcript' | 'note';
  /** seconds into the tape; absent for pure title hits */
  s?: number;
  snippet: string;
}

const PER_INTERVIEW = 3;

function foldText(s: string): string {
  return s.split(/\s+/).map(foldToken).filter(Boolean).join(' ');
}

export function searchLibrary(
  query: string,
  interviews: Interview[],
  transcripts: Record<string, Transcript>,
  notes: Record<string, Note[]>,
): SearchHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const folded = foldText(q);
  if (!folded) return [];
  const out: SearchHit[] = [];

  for (const iv of interviews) {
    let taken = 0;

    if (foldText(iv.title).includes(folded)) {
      out.push({ interviewId: iv.id, title: iv.title, kind: 'title', snippet: iv.title });
      taken++;
    }

    const words = transcripts[iv.id]?.words ?? [];
    if (words.length) {
      for (const m of findMatches(words, q)) {
        if (taken >= PER_INTERVIEW) break;
        const from = Math.max(0, m.wi - 6);
        const to = Math.min(words.length, m.wj + 7);
        out.push({
          interviewId: iv.id,
          title: iv.title,
          kind: 'transcript',
          s: words[m.wi].s,
          snippet: `…${words.slice(from, to).map((w) => w.t).join(' ')}…`,
        });
        taken++;
      }
    }

    for (const n of notes[iv.id] ?? []) {
      if (taken >= PER_INTERVIEW) break;
      const body = n.text || n.quote || '';
      if (body && foldText(body).includes(folded)) {
        out.push({
          interviewId: iv.id,
          title: iv.title,
          kind: 'note',
          s: n.anchor.s,
          snippet: body.length > 90 ? `${body.slice(0, 90)}…` : body,
        });
        taken++;
      }
    }
  }
  return out;
}
