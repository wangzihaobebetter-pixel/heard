/**
 * DropZone (DESIGN §4.3). WP3 owns this file.
 *
 * "Large drop zone / file button" — one target that is both. The whole panel is
 * a `<button>` so keyboard and touch get the file picker without a separate
 * affordance, and the drag handlers ride on top for the desktop case.
 *
 * Two things it deliberately does NOT do:
 *  - it does not validate the file (size, duration and format refusals are the
 *    Bring screen's job, because their copy is per-refusal and specified);
 *  - it does not read the file. It hands over the `File` and gets out of the way.
 *
 * `dragCounter` rather than a boolean: `dragleave` fires when the pointer
 * crosses into a *child* element, so a naive boolean flickers the highlight the
 * whole time the user is over the zone.
 */
import { useRef, useState } from 'react';
import { ACCEPT_ATTR } from '../store/presets';
import './DropZone.css';

export interface DropZoneProps {
  onFile: (file: File) => void;
  /** "Choose a recording" */
  label: string;
  /** "or drop it here" */
  hint: string;
  disabled?: boolean;
}

export default function DropZone({ onFile, label, hint, disabled }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [over, setOver] = useState(false);

  function take(list: FileList | null) {
    const file = list?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      className="dropzone"
      data-over={over ? 'yes' : 'no'}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) { dragCounter.current = 0; setOver(false); }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
    >
      <button
        type="button"
        className="dropzone__button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <span className="dropzone__mark" aria-hidden="true">▶</span>
        <span className="dropzone__label">{label}</span>
        <span className="dropzone__hint micro">{hint}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ACCEPT_ATTR}
        data-testid="file-input"
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
