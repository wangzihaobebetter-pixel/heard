/**
 * STUB — WP2 owns this screen (DESIGN §4.2, §5). The crown jewel.
 * WP0 ships the route and the id plumbing only.
 */
import { useT } from '../i18n';

export default function Interview({ id }: { id: string }) {
  const t = useT();
  return (
    <main className="screen" data-screen="interview" data-interview-id={id}>
      <h1 className="screen__title">{t('interview.title')}</h1>
      <p className="secondary">{id}</p>
      <div className="screen__placeholder">
        WP2 fills this in: Notes (Points · Quotable · Yours), the transcript with
        word spans, the player, and the press-a-line-hear-the-second interaction.
      </div>
    </main>
  );
}
