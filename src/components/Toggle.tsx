/**
 * Toggle (DESIGN §7 component inventory). WP3 owns this file.
 *
 * A real `role="switch"`, not a checkbox wearing makeup: VoiceOver says "on/off
 * switch" and the space bar works without a keydown handler of our own. The
 * one line of explanation under the label is part of the component because in
 * this product a toggle never appears without saying what it costs you
 * (§4.3 "Needed to play back what you press. Stays in your browser.").
 */
import './Toggle.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** the one line under the label; omitted when the label is self-evident */
  hint?: string;
  disabled?: boolean;
  id?: string;
}

export default function Toggle({ checked, onChange, label, hint, disabled, id }: ToggleProps) {
  return (
    <div className="toggle">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className="toggle__switch"
        data-checked={checked ? 'yes' : 'no'}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__track" aria-hidden="true">
          <span className="toggle__knob" />
        </span>
        <span className="toggle__label">{label}</span>
      </button>
      {hint ? <p className="toggle__hint secondary">{hint}</p> : null}
    </div>
  );
}
