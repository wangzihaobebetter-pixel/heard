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
import { SAMPLE_ID } from './sample/schema';
import Library from './screens/Library';
import Interview from './screens/Interview';
import Bring from './screens/Bring';
import Settings from './screens/Settings';

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

  /* First run lands INSIDE the sample (DESIGN §4, §6 moment 1) — not on a
     welcome, not on the Library. Only ever redirects once. */
  useEffect(() => {
    if (!hydrated) return;
    const id = ensureSample();
    if (firstRunSeen) return;
    useStore.getState().setUi({ firstRunSeen: true });
    if (id && (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#')) {
      window.location.hash = href('interview', { id: SAMPLE_ID });
    }
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
    </div>
  );
}

function renderRoute(name: ReturnType<typeof useRoute>['name'], params: Record<string, string>) {
  switch (name) {
    case 'interview': return <Interview id={params.id} />;
    case 'bring': return <Bring />;
    case 'settings': return <Settings />;
    case 'library': return <Library />;
    // A hash we do not recognise is a Library, never a blank page.
    case 'notfound': return <Library />;
  }
}
