/**
 * One-shot deep link: a search hit navigates to `#/i/:id` AND lands the
 * transcript on the second it named (v3 B6). The hash stays clean (the
 * router deliberately parses no query strings), so the handoff travels
 * through this module: set before navigate, taken once by the Interview
 * screen when it is ready to honour it.
 */
let pending: { id: string; s: number } | null = null;

export function setPendingSeek(id: string, s: number): void {
  pending = { id, s };
}

export function takePendingSeek(id: string): number | null {
  if (!pending || pending.id !== id) return null;
  const { s } = pending;
  pending = null;
  return s;
}
