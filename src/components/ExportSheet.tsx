/**
 * Export — the quote sheet (DESIGN §4.5). WP3 owns this file.
 *
 * "A sheet over the Interview, not a route": it is a modal layer, so the thing
 * you were reading is still behind it and closing costs nothing. Preview first,
 * then **Copy** and **Download .md** — the preview is not decoration, it is the
 * promise that what lands in the clipboard is what you just read.
 *
 * The preview is a `<pre>` holding the exact string `buildQuoteSheet` returns.
 * That is on purpose and `verify-export.mjs` depends on it: the verifier reads
 * this element's textContent and compares it byte-for-byte with the format
 * block lifted out of DESIGN.md §4.5. There is no second rendering path that
 * could drift from the real one.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interview, Note, Transcript } from '../types';
import type { StarterArtifacts } from '../content/schema';
import { useT } from '../i18n';
import { buildQuoteSheet, isQuoteSheetEmpty, quoteSheetFilename } from '../export/quotesheet';
import {
  blobToDataUri, download as saveFile, exportBasename,
  renderJson, renderMarkdown, renderShareHtml, renderSrt, renderTxt, renderVtt,
} from '../export/formats';
import { getAudio } from '../lib/storage';
import Toggle from './Toggle';
import './ui.css';
import './ExportSheet.css';

export interface ExportSheetProps {
  interview: Interview;
  notes: Note[];
  /** v3 B7: the full-format exports need the words and the AI layer */
  transcript?: Transcript | null;
  artifacts?: StarterArtifacts | null;
  onClose: () => void;
  /** the screen owns the toast, so the sheet just says what happened */
  onCopied?: (message: string) => void;
}

export default function ExportSheet({ interview, notes, transcript, artifacts, onClose, onCopied }: ExportSheetProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const empty = isQuoteSheetEmpty(notes);

  // `t` is a dependency because the sheet is localised: switching language with
  // the sheet open must re-render the section headings and "(not yet checked)".
  const sheet = useMemo(
    () => (empty ? '' : buildQuoteSheet({ interview, notes })),
    [interview, notes, empty, t],
  );

  useEffect(() => {
    // Focus the panel, not the ✕. Focusing the close button is technically
    // valid and visually shouts "leave" — a 2 px accent ring around the exit is
    // the first thing you see on a sheet whose whole job is to be read.
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sheet);
      onCopied?.(t('action.copied'));
    } catch {
      // Clipboard permission can be refused (Safari without a user gesture in
      // the same task, or an insecure origin). Falling back to a selection lets
      // the person finish the job with ⌘C instead of being told "no".
      const pre = document.querySelector('[data-testid="export-preview"]');
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  function download() {
    const blob = new Blob([sheet], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = quoteSheetFilename(interview);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately races the download in Safari; a tick is enough.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------------------------- v3 B7: full formats */

  const [withTranscript, setWithTranscript] = useState(true);
  const [summaryOnly, setSummaryOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const base = exportBasename(interview);
  const input = { interview, transcript, notes, artifacts };
  const hasWords = (transcript?.words.length ?? 0) > 0;

  async function exportAs(kind: string) {
    setBusy(kind);
    try {
      if (kind === 'md') saveFile(`${base}.md`, renderMarkdown(input, { transcript: withTranscript }), 'text/markdown;charset=utf-8');
      if (kind === 'txt') saveFile(`${base}.txt`, renderTxt(input));
      if (kind === 'srt' && transcript) saveFile(`${base}.srt`, renderSrt(transcript));
      if (kind === 'vtt' && transcript) saveFile(`${base}.vtt`, renderVtt(transcript), 'text/vtt;charset=utf-8');
      if (kind === 'json') saveFile(`${base}.json`, renderJson(input), 'application/json;charset=utf-8');
      if (kind === 'audio') {
        const blob = await getAudio(interview.id);
        if (blob) saveFile(interview.file.name || `${base}.audio`, blob);
      }
      if (kind === 'html') {
        // Inline the tape when it is on this device; the document still stands without it.
        const blob = await getAudio(interview.id);
        const audioDataUri = blob && !summaryOnly ? await blobToDataUri(blob) : undefined;
        saveFile(`${base}.html`, renderShareHtml(input, { audioDataUri, summaryOnly }), 'text/html;charset=utf-8');
      }
      onCopied?.(t('exportSheet.saved'));
    } finally {
      setBusy(null);
    }
  }

  const formats: { kind: string; label: string; enabled: boolean }[] = [
    { kind: 'md', label: 'Markdown', enabled: true },
    { kind: 'txt', label: 'TXT', enabled: hasWords },
    { kind: 'srt', label: 'SRT', enabled: hasWords },
    { kind: 'vtt', label: 'VTT', enabled: hasWords },
    { kind: 'json', label: 'JSON', enabled: true },
    { kind: 'html', label: t('exportSheet.htmlShare'), enabled: true },
    { kind: 'audio', label: t('exportSheet.audio'), enabled: interview.file.kept },
  ];

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t('exportSheet.title')} data-testid="export-sheet">
      <button type="button" className="sheet__scrim" aria-label={t('action.close')} onClick={onClose} />
      <div className="sheet__panel" ref={panelRef} tabIndex={-1}>
        <header className="sheet__header">
          <h2 className="sheet__title">{t('exportSheet.title')}</h2>
          <button
            type="button"
            className="iconbutton"
            aria-label={t('action.close')}
            data-testid="export-close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        {/* v3 B7: every format the recording can honestly produce (§4.6). */}
        <div className="sheet__formats" data-testid="export-formats">
          <p className="micro sheet__formats-label">{t('exportSheet.formats')}</p>
          <div className="sheet__formats-row">
            {formats.filter((f) => f.enabled).map((f) => (
              <button
                key={f.kind}
                type="button"
                className="button button--secondary"
                data-testid={`export-${f.kind}`}
                disabled={busy !== null}
                onClick={() => { void exportAs(f.kind); }}
              >
                {busy === f.kind ? '…' : f.label}
              </button>
            ))}
          </div>
          <div className="sheet__formats-opts">
            {hasWords ? (
              <Toggle
                id="export-with-transcript"
                checked={withTranscript}
                onChange={setWithTranscript}
                label={t('exportSheet.withTranscript')}
              />
            ) : null}
            <Toggle
              id="export-summary-only"
              checked={summaryOnly}
              onChange={setSummaryOnly}
              label={t('exportSheet.summaryOnly')}
              hint={t('exportSheet.summaryOnlyWhy')}
            />
          </div>
        </div>

        {empty ? (
          <div className="notice">
            <p className="notice__text">{t('exportSheet.empty')}</p>
          </div>
        ) : (
          <>
            <pre className="sheet__preview" data-testid="export-preview">{sheet}</pre>
            <div className="sheet__actions">
              <button type="button" className="button button--primary" data-testid="export-copy" onClick={copy}>
                {t('action.copy')}
              </button>
              <button type="button" className="button button--secondary" data-testid="export-download" onClick={download}>
                {t('action.download')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
