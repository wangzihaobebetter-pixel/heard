/**
 * STUB — WP3 owns this screen (DESIGN §4.1).
 * WP0 ships the route, the title and the hero so the shell is never blank.
 */
import { useT } from '../i18n';
import { href } from '../router';

export default function Library() {
  const t = useT();
  return (
    <main className="screen" data-screen="library">
      <div className="hero">
        <p className="hero__line">{t('app.tagline')}</p>
        <p className="hero__sub">{t('app.taglineSub')}</p>
      </div>
      <h1 className="screen__title">{t('library.title')}</h1>
      <div className="screen__placeholder">
        WP3 fills this in: interview cards, the sample card, the empty state,
        and <a href={href('bring')}>{t('action.bringRecording')}</a>.
      </div>
    </main>
  );
}
