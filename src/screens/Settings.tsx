/**
 * STUB — WP3 owns this screen (DESIGN §4.4).
 */
import { useT } from '../i18n';

export default function Settings() {
  const t = useT();
  return (
    <main className="screen" data-screen="settings">
      <h1 className="screen__title">{t('settings.title')}</h1>
      <div className="screen__placeholder">
        WP3 fills this in: {t('settings.transcription')} · {t('settings.notes')} ·{' '}
        {t('settings.language')} · {t('settings.theme')} · {t('settings.storage')} ·{' '}
        {t('settings.about')}
      </div>
    </main>
  );
}
