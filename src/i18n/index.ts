/**
 * Minimal string registry (DESIGN §9, WP0). No i18n library: two flat tables,
 * a `t(key)` that interpolates `{name}`, and a build-time parity check.
 *
 *   registerStrings('bring', { en: {...}, 'zh-CN': {...} })
 *   const t = useT(); t('bring.choose')
 *
 * Why the parity check matters more than it sounds: `translate()` falls back to
 * en and then to the RAW KEY, so a key missing from English ships on screen as
 * the literal string `bring.choose`. The precedent app did exactly that once.
 * `verify-i18n.mjs` fails the build on either direction of a gap.
 */
import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'zh-CN';
export type StringTable = Record<string, string>;

const tables: Record<Lang, StringTable> = { en: {}, 'zh-CN': {} };
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function registerStrings(pkg: string, table: { en: StringTable; 'zh-CN': StringTable }): void {
  for (const lang of ['en', 'zh-CN'] as Lang[]) {
    for (const [k, v] of Object.entries(table[lang] ?? {})) {
      tables[lang][k.startsWith(`${pkg}.`) ? k : `${pkg}.${k}`] = v;
    }
  }
  emit();
}

let current: Lang = 'en';

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  emit();
}

export function getLang(): Lang {
  return current;
}

/** The store keeps `ui.lang` as 'en' | 'zh'; the tables are keyed 'en' | 'zh-CN'. */
export function resolveLang(pref: 'en' | 'zh' | 'auto'): Lang {
  if (pref === 'zh') return 'zh-CN';
  if (pref === 'en') return 'en';
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return nav.startsWith('zh') ? 'zh-CN' : 'en';
}

export function translate(key: string, vars?: Record<string, string | number>): string {
  const raw = tables[current][key] ?? tables.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useT() {
  useSyncExternalStore(subscribe, () => version, () => version);
  return translate;
}

export function useLang(): Lang {
  useSyncExternalStore(subscribe, () => version, () => version);
  return current;
}

/** Test/verification hook — the registered key set, both languages. */
export function _tables(): Record<Lang, StringTable> {
  return tables;
}
