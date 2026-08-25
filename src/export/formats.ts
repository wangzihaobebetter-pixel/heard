/**
 * Export renderers (v3 B7, PRODUCT-SPEC §4.6) — a local-first app has no
 * excuse on export, so every format is a pure function of the recording's
 * own data. No network, no service, no lock-in:
 *
 *   markdown  — notes + chapters + summary (+ optional full transcript),
 *               timestamps preserved
 *   txt       — the transcript as plain paragraphs with timecodes
 *   srt/vtt   — subtitles from the provider segments' real times
 *   json      — EVERYTHING (interview, transcript, notes, artifacts):
 *               honest total ownership
 *   shareHtml — one self-contained file: player + transcript + notes,
 *               audio inlined base64, works offline, opens anywhere.
 *               `summaryOnly` is the Granola boundary: guests get the
 *               document, not the tape.
 */
import type { Interview, Note, Transcript, Word } from '../types';
import type { StarterArtifacts } from '../content/schema';
import { buildParagraphs } from '../components/TranscriptParagraph';
import { formatAnchorLocation, formatDuration, formatTimecode } from '../lib/time';
import { formatSheetDate } from './quotesheet';

export interface ExportInput {
  interview: Interview;
  transcript?: Transcript | null;
  notes: Note[];
  artifacts?: StarterArtifacts | null;
}

const spanText = (words: Word[], wi?: number, wj?: number): string =>
  wi != null && wj != null ? words.slice(wi, wj).map((w) => w.t).join(' ') : '';

function paragraphLines(t: Transcript): { at: string; text: string }[] {
  return buildParagraphs(t).map((p) => ({
    at: formatTimecode(p.s),
    text: p.words.map((w) => w.t).join(' '),
  }));
}

/* ---------------------------------------------------------------- markdown */

export function renderMarkdown(input: ExportInput, opts: { transcript?: boolean } = {}): string {
  const { interview, transcript, notes, artifacts } = input;
  const out: string[] = [];
  out.push(`# ${interview.title}`);
  out.push(`Recorded ${formatSheetDate(interview.recordedAt ?? interview.createdAt)} · ${formatDuration(interview.durationSec)} · transcribed with Heard`);
  out.push('');

  if (artifacts?.summary.text) {
    out.push('## Summary', '');
    // [n] markers stay in the text; the citation list beneath keeps their receipts.
    out.push(artifacts.summary.text, '');
    if (artifacts.summary.citations.some(Boolean)) {
      artifacts.summary.citations.forEach((c, i) => {
        if (c) out.push(`[${i + 1}]: ${formatTimecode(c.s)} "${c.quote}"`);
      });
      out.push('');
    }
  }
  if (artifacts?.chapters.length) {
    out.push('## Chapters', '');
    for (const c of artifacts.chapters) out.push(`- [${formatTimecode(c.at.s)}] ${c.title}`);
    out.push('');
  }
  if (artifacts?.concepts.length) {
    out.push('## Key concepts', '');
    for (const c of artifacts.concepts) out.push(`- **${c.term}** — ${c.definition} _(${formatTimecode(c.cite.s)})_`);
    out.push('');
  }
  if (artifacts?.flags.length) {
    out.push('## Flagged', '');
    for (const f of artifacts.flags) out.push(`- [${formatTimecode(f.cite.s)}] ${f.text}`);
    out.push('');
  }

  if (notes.length) {
    out.push('## Notes', '');
    for (const n of notes) {
      const mark = n.heard ? '✓' : ' ';
      out.push(`- [${formatAnchorLocation(n.anchor)}] ${mark} ${n.text || n.quote || ''}`);
      if (n.kind === 'point' && n.quote) out.push(`      "…${n.quote}…"`);
    }
    out.push('');
  }

  if (opts.transcript && transcript?.words.length) {
    out.push('## Transcript', '');
    for (const p of paragraphLines(transcript)) out.push(`**[${p.at}]** ${p.text}`, '');
  }
  return out.join('\n');
}

/* --------------------------------------------------------------------- txt */

export function renderTxt(input: ExportInput): string {
  const { interview, transcript } = input;
  const out = [interview.title, ''];
  if (transcript?.words.length) {
    for (const p of paragraphLines(transcript)) out.push(`[${p.at}] ${p.text}`, '');
  }
  return out.join('\n');
}

/* --------------------------------------------------------------- subtitles */

function srtTime(sec: number, sepMs: string): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sepMs}${p(r, 3)}`;
}

/** Cues are the provider segments — real speech times, never invented. */
function cues(t: Transcript): { s: number; e: number; text: string }[] {
  return t.segments
    .map((seg) => ({ s: seg.s, e: seg.e, text: spanText(t.words, seg.wi, seg.wj) }))
    .filter((c) => c.text.trim().length > 0);
}

export function renderSrt(t: Transcript): string {
  return cues(t)
    .map((c, i) => `${i + 1}\n${srtTime(c.s, ',')} --> ${srtTime(c.e, ',')}\n${c.text}`)
    .join('\n\n') + '\n';
}

export function renderVtt(t: Transcript): string {
  return 'WEBVTT\n\n' + cues(t)
    .map((c) => `${srtTime(c.s, '.')} --> ${srtTime(c.e, '.')}\n${c.text}`)
    .join('\n\n') + '\n';
}

/* -------------------------------------------------------------------- json */

export function renderJson(input: ExportInput): string {
  return JSON.stringify({
    exportedWith: 'Heard',
    exportedAt: new Date().toISOString(),
    interview: input.interview,
    transcript: input.transcript ?? null,
    notes: input.notes,
    artifacts: input.artifacts ?? null,
  }, null, 2);
}

/* -------------------------------------------------------------- share html */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One file, everything inside, Reading Room in miniature. With audio: click
 * any paragraph timecode to hear it. `summaryOnly`: the document without the
 * transcript — what you hand a guest.
 */
export function renderShareHtml(
  input: ExportInput,
  opts: { audioDataUri?: string; summaryOnly?: boolean } = {},
): string {
  const { interview, transcript, notes, artifacts } = input;
  const paras = !opts.summaryOnly && transcript?.words.length ? buildParagraphs(transcript) : [];

  const noteRows = notes.map((n) => `
    <div class="note${n.kind === 'yours' ? ' yours' : ''}">
      <button class="tc" data-s="${n.anchor.s}">${formatTimecode(n.anchor.s)}</button>
      <div><p class="ntext">${esc(n.text || n.quote || '')}</p>${n.kind === 'point' && n.quote ? `<p class="nquote">“…${esc(n.quote)}…”</p>` : ''}</div>
    </div>`).join('');

  const summary = artifacts?.summary.text
    ? `<h2>Summary</h2>${artifacts.summary.text.split(/\n\n+/).map((p) => `<p class="ai">${esc(p)}</p>`).join('')}`
    : '';
  const chapters = artifacts?.chapters.length
    ? `<h2>Chapters</h2>${artifacts.chapters.map((c) => `<p class="chap"><button class="tc" data-s="${c.at.s}">${formatTimecode(c.at.s)}</button> ${esc(c.title)}</p>`).join('')}`
    : '';

  const transcriptHtml = paras.length
    ? `<h2>Transcript</h2>${paras.map((p) => `<p class="para"><button class="tc" data-s="${p.s}">${formatTimecode(p.s)}</button> ${esc(p.words.map((w) => w.t).join(' '))}</p>`).join('')}`
    : '';

  const audio = opts.audioDataUri
    ? `<audio id="player" controls preload="metadata" src="${opts.audioDataUri}"></audio>`
    : '';

  return `<!doctype html>
<html lang="${esc(transcript?.lang ?? 'en')}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(interview.title)} — Heard</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 68ch; padding: 32px 20px 80px; background: #FAF8F4; color: #1B1813;
         font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; }
  h1 { font-family: ui-serif, 'New York', Georgia, 'Songti SC', serif; font-weight: 500; font-size: 28px; margin: 0 0 4px; }
  .meta { color: #5D574C; font-size: 14px; margin: 0 0 24px; }
  h2 { font-size: 13px; letter-spacing: .02em; color: #9A937F; font-weight: 600; margin: 32px 0 8px; }
  audio { width: 100%; margin: 16px 0; }
  .tc { font: 500 13px/1 ui-monospace, 'SF Mono', Menlo, monospace; color: #D9481C; background: none;
        border: 1px solid rgba(28,24,18,.16); border-radius: 8px; padding: 4px 8px; cursor: pointer; }
  .para, .chap { margin: 0 0 14px; }
  .ai { color: #5D574C; }
  .note { display: flex; gap: 10px; align-items: baseline; background: #fff; border: 1px solid rgba(28,24,18,.09);
          border-radius: 12px; padding: 12px; margin: 0 0 10px; }
  .note.yours { border-left: 2px solid #1B1813; }
  .ntext { margin: 0; }
  .nquote { margin: 4px 0 0; color: #5D574C; font-size: 14px; }
  .credit { margin-top: 40px; padding-top: 16px; border-top: 1px solid rgba(28,24,18,.09); color: #9A937F; font-size: 13px; }
</style>
<body>
  <h1>${esc(interview.title)}</h1>
  <p class="meta">${formatSheetDate(interview.recordedAt ?? interview.createdAt)} · ${formatDuration(interview.durationSec)} · made with Heard</p>
  ${audio}
  ${summary}
  ${chapters}
  ${notes.length ? '<h2>Notes</h2>' + noteRows : ''}
  ${transcriptHtml}
  <p class="credit">Exported from Heard — notes pinned to the moment they were said.</p>
  <script>
    var player = document.getElementById('player');
    if (player) document.addEventListener('click', function (e) {
      var b = e.target.closest('.tc'); if (!b) return;
      player.currentTime = Number(b.dataset.s) || 0; player.play();
    });
  </script>
</body>
</html>`;
}

/* ---------------------------------------------------------------- download */

export function download(filename: string, data: string | Blob, mime = 'text/plain;charset=utf-8'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const exportBasename = (interview: Interview): string =>
  (interview.title || 'recording').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);

export function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
