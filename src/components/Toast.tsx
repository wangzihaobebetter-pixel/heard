/**
 * Toast (DESIGN §7: "single line, bottom, 2.4 s"). WP3 owns this file.
 *
 * Deliberately not a notification system: one line, one at a time, no queue, no
 * action button, no dismiss affordance. It exists to confirm a thing the user
 * just did ("Copied"), and a confirmation that outlives the moment is clutter.
 *
 * `role="status"` rather than `alert` — this is never urgent, and `alert`
 * interrupts a screen reader mid-sentence.
 */
import { useEffect, useState } from 'react';
import './Toast.css';

const DWELL_MS = 2400;

export interface ToastProps {
  /** change this string to show a toast; set to null to clear */
  message: string | null;
  onDone?: () => void;
}

export default function Toast({ message, onDone }: ToastProps) {
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!message) { setShown(null); return; }
    setShown(message);
    const timer = window.setTimeout(() => {
      setShown(null);
      onDone?.();
    }, DWELL_MS);
    return () => window.clearTimeout(timer);
    // `onDone` is intentionally not a dependency: a caller that recreates the
    // callback each render would otherwise restart the timer forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!shown) return null;
  return (
    <div className="toast" role="status" aria-live="polite" data-testid="toast">
      {shown}
    </div>
  );
}

/** Small helper so screens do not each reinvent "show this for a moment". */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  return { message, show: setMessage, clear: () => setMessage(null) };
}
