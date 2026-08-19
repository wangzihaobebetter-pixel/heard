/** Ids and clock, in one place so tests and the sample can pin them. WP0 owns this. */

export function now(): number {
  return Date.now();
}

/** `n_l3k9x1a2` — short, sortable enough, no dependency. */
export function id(prefix = 'x'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
