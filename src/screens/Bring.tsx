/**
 * STUB — WP3 owns this screen (DESIGN §4.3).
 */
import { useT } from '../i18n';

export default function Bring() {
  const t = useT();
  return (
    <main className="screen" data-screen="bring">
      <h1 className="screen__title">{t('bring.title')}</h1>
      <div className="screen__placeholder">
        WP3 fills this in: the drop zone, title/language, the keep-audio toggle,
        the inline transcription key, and {t('action.listenOnce')}.
      </div>
    </main>
  );
}
