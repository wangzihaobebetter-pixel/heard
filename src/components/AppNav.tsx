import type { RouteName } from '../router';
import { href } from '../router';
import { useT } from '../i18n';

interface AppNavProps {
  active: RouteName;
}

type IconName = 'library' | 'record' | 'bring' | 'settings';

function Glyph({ name }: { name: IconName }) {
  if (name === 'library') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5.5h5.5c1 0 1.5.5 1.5 1.5v12c0-1-.5-1.5-1.5-1.5H5zM19 5.5h-5.5c-1 0-1.5.5-1.5 1.5v12c0-1 .5-1.5 1.5-1.5H19z" />
      </svg>
    );
  }
  if (name === 'record') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7.5" />
        <circle className="appnav__record-dot" cx="12" cy="12" r="3.2" />
      </svg>
    );
  }
  if (name === 'bring') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17.5v2h14v-2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M8 7v0M5 12h14m-4 0v0M5 17h14m-9 0v0" />
      <circle cx="8" cy="7" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="10" cy="17" r="1.6" />
    </svg>
  );
}

function NavLink({ to, label, icon, active }: {
  to: RouteName;
  label: string;
  icon: IconName;
  active: boolean;
}) {
  return (
    <a
      className="appnav__link"
      href={href(to)}
      aria-current={active ? 'page' : undefined}
      data-nav={to}
    >
      <Glyph name={icon} />
      <span>{label}</span>
    </a>
  );
}

export default function AppNav({ active }: AppNavProps) {
  const t = useT();
  return (
    <nav className="appnav" data-testid="app-nav" aria-label={t('nav.primary')}>
      <a className="appnav__brand" href={href('library')} aria-label={t('app.nameFull')}>
        <span>h</span><i aria-hidden="true" />
      </a>
      <div className="appnav__items">
        <NavLink to="library" icon="library" label={t('nav.library')} active={active === 'library' || active === 'notfound'} />
        <NavLink to="record" icon="record" label={t('nav.record')} active={active === 'record'} />
        <NavLink to="bring" icon="bring" label={t('nav.bring')} active={active === 'bring'} />
      </div>
      <NavLink to="settings" icon="settings" label={t('nav.settings')} active={active === 'settings'} />
    </nav>
  );
}
