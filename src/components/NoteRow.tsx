/**
 * NoteRow — the unit of the Notes pane (DESIGN §4.2, §5, §6 moment 2).
 *
 * Anatomy, left to right: the timecode chip; the note text (≤ 2 lines at
 * rest); a ✓ heard control. Under the text, in muted small type, the verbatim
 * quote it was pinned to, one line, behind a hairline quote mark.
 *
 * Two behaviours carry the product's ethics rather than its features:
 *   - an unaligned note says so, in words, under itself ("couldn't pin this to
 *     the tape — nearest place shown"). It does not quietly round.
 *   - ✓ heard is only ever set by the person. Nothing here can set it.
 *
 * After a span finishes playing the row keeps a faint wash for 1.6 s and the ✓
 * control is emphasised for 3 s — the invitation to mark it, without a modal.
 */
import { useEffect, useRef, useState } from 'react';
import type { Note } from '../types';
import { useT } from '../i18n';
import TimecodeChip from './TimecodeChip';
import './NoteRow.css';

export interface NoteRowProps {
  note: Note;
  hasAudio: boolean;
  /** this row's span is the one currently playing */
  playing?: boolean;
  /** the span just ended here — faint wash, ✓ invited */
  afterglow?: boolean;
  focused?: boolean;
  onPress: (note: Note) => void;
  onToggleHeard: (note: Note) => void;
  onEdit?: (note: Note, text: string) => void;
  onDelete?: (note: Note) => void;
  onFocus?: (note: Note) => void;
}

export default function NoteRow({
  note, hasAudio, playing, afterglow, focused,
  onPress, onToggleHeard, onEdit, onDelete, onFocus,
}: NoteRowProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const editable = note.kind === 'yours' && !!onEdit;
  const unpinned = note.anchor.quality === 'unpinned';

  useEffect(() => { setDraft(note.text); }, [note.text]);
  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // Scroll a keyboard-focused row into view, so `↑/↓` through the notes never
  // leaves the caret somewhere the eye is not.
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== note.text) onEdit?.(note, next);
    else setDraft(note.text);
  }

  return (
    <div
      ref={rowRef}
      className="note"
      data-testid="note-row"
      data-note-id={note.id}
      data-kind={note.kind}
      data-playing={playing ? 'true' : 'false'}
      data-afterglow={afterglow ? 'true' : 'false'}
      data-heard={note.heard ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
      onMouseDown={() => onFocus?.(note)}
    >
      <div className="note__bar" aria-hidden="true" />

      <div className="note__chip">
        <TimecodeChip
          anchor={note.anchor}
          hasAudio={hasAudio}
          pressed={playing}
          onPress={() => onPress(note)}
        />
      </div>

      <div className="note__main">
        {editing ? (
          <textarea
            ref={textareaRef}
            className="note__edit"
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.preventDefault(); setDraft(note.text); setEditing(false); }
            }}
          />
        ) : (
          <p
            className="note__text"
            data-testid="note-text"
            onDoubleClick={editable ? () => setEditing(true) : undefined}
          >
            {note.text}
          </p>
        )}

        {/* The receipt under the claim. A 'quote'/'yours' note IS its quote, so
            repeating it under itself would be noise. */}
        {note.quote && note.kind === 'point' && !editing ? (
          <p className="note__quote secondary" data-testid="note-quote">
            <span className="note__quotemark" aria-hidden="true" />
            {note.quote}
          </p>
        ) : null}

        {unpinned ? (
          <p className="note__unpinned micro" data-testid="note-unpinned">{t('interview.unpinned')}</p>
        ) : null}
      </div>

      <div className="note__side">
        <button
          type="button"
          className="heard"
          data-testid="heard-toggle"
          data-on={note.heard ? 'true' : 'false'}
          aria-pressed={note.heard}
          aria-label={t('interview.heard')}
          onClick={(e) => { e.stopPropagation(); onToggleHeard(note); }}
        >
          <span className="heard__tick" aria-hidden="true" />
          <span className="heard__label">{t('interview.heard')}</span>
        </button>

        {onDelete || editable ? (
          <div className="note__menu">
            <button
              type="button"
              className="iconbtn"
              aria-label={t('action.more')}
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            >
              <span aria-hidden="true">⋯</span>
            </button>
            {menuOpen ? (
              <div className="menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                {editable ? (
                  <button type="button" role="menuitem" className="menu__item"
                    onClick={() => { setMenuOpen(false); setEditing(true); }}>
                    {t('action.rename')}
                  </button>
                ) : null}
                {onDelete ? (
                  <button type="button" role="menuitem" className="menu__item"
                    onClick={() => { setMenuOpen(false); onDelete(note); }}>
                    {t('action.delete')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
