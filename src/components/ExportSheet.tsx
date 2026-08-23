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
import { useEffect, useMemo, useRef } from 'react';
import type { Interview, Note } from '../types';
import { useT } from '../i18n';
import { buildQuoteSheet, isQuoteSheetEmpty, quoteSheetFilename } from '../export/quotesheet';
import './ui.css';
import './ExportSheet.css';

export interface ExportSheetProps {
  interview: Interview;
  notes: Note[];
  onClose: () => void;
  /** the screen owns the toast, so the sheet just says what happened */
  onCopied?: (message: string) => void;
}

export default function ExportSheet({ interview, notes, onClose, onCopied }: ExportSheetProps) {
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
