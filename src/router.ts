/**
 * Hash router — four routes, nothing else (DESIGN §4). WP0 owns this file.
 *
 * Hash, not the history API: the app deploys to a GitHub Pages project
 * sub-path with `base: './'`, and deep links plus refresh must both work with
 * no server rewrite rule.
 *
 *   #/            library
 *   #/i/:id       interview
 *   #/add         bring
 *   #/rec         record (v3 B2)
 *   #/settings    settings
 *
 * An unknown hash resolves to `notfound`, and App renders the Library for it.
 * A white screen on a bad URL is the one failure the precedent app shipped and
 * we do not repeat it.
 */
import { useCallback, useSyncExternalStore } from 'react';

export type RouteName = 'library' | 'interview' | 'bring' | 'record' | 'settings' | 'notfound';

export interface Route {
  name: RouteName;
  params: Record<string, string>;
  hash: string;
}

interface Pattern { name: RouteName; segments: string[] }

const MAX_SEEK_SEC = 7 * 24 * 60 * 60;

const PATTERNS: Pattern[] = [
  { name: 'library',   segments: [] },
  { name: 'interview', segments: ['i', ':id'] },
  { name: 'bring',     segments: ['add'] },
  { name: 'record',    segments: ['rec'] },
  { name: 'settings',  segments: ['settings'] },
];

export function parseHash(hash: string): Route {
  const withoutHash = (hash || '').replace(/^#/, '').replace(/^\//, '');
  const [path, query = ''] = withoutHash.split('?', 2);
  const clean = path;
  const parts = clean ? clean.split('/').filter(Boolean) : [];

  for (const pattern of PATTERNS) {
    if (pattern.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = pattern.segments[i];
      if (seg.startsWith(':')) {
        // A malformed escape must fail closed to notfound, not throw during render.
        try {
          const value = decodeURIComponent(parts[i]);
          if (!value) { ok = false; break; }
          params[seg.slice(1)] = value;
        } catch { ok = false; break; }
      } else if (seg !== parts[i]) { ok = false; break; }
    }
    if (ok) {
      if (pattern.name === 'interview' && query) {
        const rawTime = new URLSearchParams(query).get('t');
        const time = rawTime == null ? NaN : Number(rawTime);
        if (Number.isFinite(time) && time >= 0 && time <= MAX_SEEK_SEC) params.t = String(time);
      }
      return { name: pattern.name, params, hash };
    }
  }
  return { name: 'notfound', params: {}, hash };
}

export function href(
  name: RouteName,
  params: Record<string, string> = {},
  query: { t?: string | number } = {},
): string {
  const pattern = PATTERNS.find((p) => p.name === name);
  if (!pattern) return '#/';
  const path = pattern.segments
    .map((s) => (s.startsWith(':') ? encodeURIComponent(params[s.slice(1)] ?? '') : s))
    .join('/');
  if (name === 'interview' && query.t != null) {
    const time = Number(query.t);
    if (Number.isFinite(time) && time >= 0 && time <= MAX_SEEK_SEC) {
      return `#/${path}?t=${encodeURIComponent(String(time))}`;
    }
  }
  return `#/${path}`;
}

export function navigate(name: RouteName, params?: Record<string, string>): void {
  const target = href(name, params);
  if (window.location.hash !== target) window.location.hash = target;
}

/** Same destination without a history entry — used when Bring hands off to the new interview. */
export function replace(name: RouteName, params?: Record<string, string>): void {
  const target = href(name, params);
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${target}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

function snapshot() {
  return window.location.hash || '#/';
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '#/');
  return parseHash(hash);
}

export function useNavigate() {
  return useCallback((name: RouteName, params?: Record<string, string>) => navigate(name, params), []);
}
