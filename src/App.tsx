/**
 * App shell and route table (DESIGN §4). WP0 owns this file.
 *
 * Two rules encoded here that came out of the precedent app:
 *  - an unknown hash renders the Library, never a white screen;
 *  - theme and language are applied from the store on every change, and were
 *    already applied pre-paint by the inline script in index.html.
 */
import { useEffect, useState } from 'react';
import { useRoute, href } from './router';
import { useStore } from './store';
import { resolveLang, setLang, useT } from './i18n';
import { ensureSample } from './sample/load';
import { ensureStarterLibrary } from './content/load';
import Library from './screens/Library';
import Interview from './screens/Interview';
import Bring from './screens/Bring';
import Record from './screens/Record';
import Settings from './screens/Settings';
import { useRecorder } from './audio/recorder';
import { maybeRunIntake } from './audio/intake';
import { formatDuration } from './lib/time';

function applyTheme(theme: 'system' | 'paper' | 'ink') {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper')
    : theme;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'ink' ? '#131210' : '#F6F4EF');
}

export default function App() {
  const route = useRoute();
  const t = useT();
  const theme = useStore((s) => s.settings.ui.theme);
  const lang = useStore((s) => s.settings.ui.lang);
  const firstRunSeen = useStore((s) => s.ui.firstRunSeen);

  /* Hydration is async (IndexedDB), and `hasHydrated()` is NOT reactive — a
     plain read leaves the first-run effect wired to a value that never changes,
     so on a fresh install the sample would never be seeded. Subscribe instead. */
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    const unsub = useStore.persist.onFinishHydration(() => setHydrated(true));
    // It can also finish between the initial render and this subscription.
    if (useStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => { setLang(resolveLang(lang)); }, [lang]);

  /* v3 B3: a provider key arriving is what every `waiting` recording was
     waiting FOR — sweep them instead of making the user re-open each one.
     Also collects interviews stranded at `listening` by a closed tab. */
  const sttKey = useStore((s) => s.settings.stt.key);
  useEffect(() => {
    if (!hydrated || !sttKey.trim()) return;
    const { interviews } = useStore.getState();
    for (const iv of Object.values(interviews)) {
      if (iv.status === 'waiting' || iv.status === 'listening') maybeRunIntake(iv.id);
    }
  }, [hydrated, sttKey]);

  /* First run lands INSIDE a real recording (DESIGN §4, §6 moment 1; v3
     PRODUCT-SPEC §4.7) — not on a welcome, not on the Library. The starter
     library is the front door; the bundled NASA sample remains the offline
     fallback, because a first run with no network still deserves a first act.
     Only ever redirects once. */
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void ensureStarterLibrary().then((starterId) => {
      if (cancelled) return;
      const state = useStore.getState();
      if (state.ui.firstRunSeen) return;
      const id = starterId ?? ensureSample();
      state.setUi({ firstRunSeen: true });
      if (id && (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#')) {
        window.location.hash = href('interview', { id });
      }
    });
    return () => { cancelled = true; };
  }, [hydrated, firstRunSeen]);

  return (
    <div className="shell">
      <header className="appbar">
        <a className="appbar__name" href={href('library')}>{t('app.name')}</a>
        <span className="appbar__spacer" />
        <a href={href('bring')}>{t('action.bringRecording')}</a>
        <a href={href('settings')} aria-label={t('settings.title')}>{t('settings.title')}</a>
      </header>
      {renderRoute(route.name, route.params)}
      {route.name !== 'record' ? <RecorderBar /> : null}
    </div>
  );
}

/**
 * The tape does not stop because the screen changed (§4.1): while a recording
 * is live anywhere but the Record screen, one fixed line shows it is still
 * rolling and takes you back.
 */
function RecorderBar() {
  const t = useT();
  const phase = useRecorder((s) => s.phase);
  const elapsedSec = useRecorder((s) => s.elapsedSec);
  if (phase === 'idle') return null;
  const paused = phase === 'paused';
  return (
    <a className="recbar" href={href('record')} data-testid="recbar" data-paused={paused ? 'true' : 'false'}>
      <span className="recbar__dot" aria-hidden="true" />
      <span>{paused ? t('record.paused') : t('record.recording')}</span>
      <span className="topbar__spacer" />
      <span className="tabular">{formatDuration(elapsedSec)}</span>
    </a>
  );
}

function renderRoute(name: ReturnType<typeof useRoute>['name'], params: Record<string, string>) {
  switch (name) {
    case 'interview': return <Interview id={params.id} />;
    case 'bring': return <Bring />;
    case 'record': return <Record />;
    case 'settings': return <Settings />;
    case 'library': return <Library />;
    // A hash we do not recognise is a Library, never a blank page.
    case 'notfound': return <Library />;
  }
}
