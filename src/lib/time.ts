/**
 * Timecode formatting (DESIGN §4.5, §5, §7). WP0 owns this file.
 *
 * One rule underneath all of it: timecodes are rendered with tabular numerals
 * and must align down a column, so the *shape* of the string is part of the
 * contract — `14:32` and `1:14:32`, never `00:14:32`, never `14m32s`.
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `14:32` under an hour, `1:14:32` at or over it. Chips and the export use this. */
export function formatTimecode(sec: number): string {
  const total = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * A note location for export. An unpinned anchor may carry a nearest-place
 * second for UI context, but exporting that second as exact would overclaim.
 */
export function formatAnchorLocation(anchor: { s: number; quality: string }): string {
  return anchor.quality === 'unpinned' ? 'unlocated' : formatTimecode(anchor.s);
}

/** `14:31.2` — the player's readout while seeking (DESIGN §5, "tenths while seeking"). */
export function formatTimecodeTenths(sec: number): string {
  const safe = Math.max(0, sec || 0);
  const tenths = Math.floor((safe * 10) % 10);
  return `${formatTimecode(safe)}.${tenths}`;
}

/** `1:32:07` — a duration, always h:mm:ss once it passes an hour. Same shape as a timecode. */
export function formatDuration(sec: number): string {
  return formatTimecode(sec);
}

/** `92` from 5520 — whole minutes, for "Heard 41 of 92 min". Rounds up so 0.4 min is not "0". */
export function minutesOf(sec: number): number {
  return Math.max(0, Math.ceil((sec || 0) / 60));
}

/** Bytes as the Bring screen says them: `44 MB`, `880 KB`. Never `44.00 MB`. */
export function formatBytes(bytes: number): string {
  const b = Math.max(0, bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  const mb = b / (1024 * 1024);
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Parses `14:32` / `1:14:32` back to seconds. Returns null on anything else. */
export function parseTimecode(text: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d))?$/.exec(text.trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  if (min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s + (m[4] ? Number(m[4]) / 10 : 0);
}
