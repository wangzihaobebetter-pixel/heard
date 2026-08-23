/**
 * Settings `#/settings` (DESIGN §4.4). WP3 owns this screen.
 *
 * Sections in §4.4's order, which is an order of *consequence*, not of
 * category: the two keys that make the product work, then the sentence that
 * says what the second one does and does not do, then language, theme,
 * what this device is holding, and who to credit.
 *
 * The **Test** buttons send something real. §4.4 asks for "a 1-second bundled
 * silence WAV" for transcription: WP1's `testKey` builds exactly that
 * (`Float32Array(16000)` at 16 kHz through its own WAV writer) and posts it, so
 * a green Test means the base URL resolved, CORS allowed the browser origin,
 * the key was accepted and the model name exists. The elapsed time in
 * "OK, 0.4 s" is measured here around that call.
 *
 * INTEGRATOR SEAM — `testChat` below is WP3's own minimal probe for the notes
 * provider (one chat completion, one token). WP4 owns `src/notes/*`; when it
 * lands a test-call of its own, swap `testChat` for it and delete this one.
 * There is no equivalent of WP1's silence WAV for a chat model, so this asks
 * the cheapest question that still proves the round trip.
 */
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { href } from '../router';
import { useStore, selectInterviewList } from '../store';
import { LLM_PRESETS, STT_PRESETS } from '../store/presets';
import { audioBytes, isStorageDegraded } from '../lib/storage';
import { formatBytes } from '../lib/time';
import { sampleBundle } from '../sample/load';
import { testKey } from '../audio/transcribe';
import KeyField, { type TestResult } from '../components/KeyField';
import Toggle from '../components/Toggle';
import Toast, { useToast } from '../components/Toast';
import '../components/ui.css';
import './Settings.css';

/** Kept in step with package.json by `verify-export.mjs`, which fails the build on drift. */
const APP_VERSION = '0.1.0';
const GITHUB_URL = 'https://github.com/wangzihaobebetter-pixel/heard';

/** WP3's stand-in for a WP4 notes test-call. See the seam note above. */
async function testChat(cfg: { baseUrl: string; key: string; model: string }): Promise<TestResult> {
  const started = performance.now();
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (!res.ok) {
      // §4.4: "status code + provider's message, one line, no stack traces".
      let message = res.statusText;
      try {
        const body = await res.json() as { error?: { message?: string } };
        if (body?.error?.message) message = body.error.message;
      } catch { /* a non-JSON error body is still an error */ }
      return { ok: false, status: String(res.status), message };
    }
    return { ok: true, seconds: (performance.now() - started) / 1000 };
  } catch (err) {
    return { ok: false, status: '—', message: err instanceof Error ? err.message : String(err) };
  }
}

export default function Settings() {
  const t = useT();
  const toast = useToast();

  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const applySttPreset = useStore((s) => s.applySttPreset);
  const applyLlmPreset = useStore((s) => s.applyLlmPreset);
  const interviews = useStore(selectInterviewList);
  const forgetAudio = useStore((s) => s.forgetAudio);

  const [bytes, setBytes] = useState<number | null>(null);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    let live = true;
    void audioBytes().then((n) => { if (live) setBytes(n); });
    setDegraded(isStorageDegraded());
    return () => { live = false; };
  }, [interviews.length]);

  const sttProvider = useMemo(
    () => STT_PRESETS.find((p) => p.id === settings.stt.preset)?.label ?? settings.stt.preset,
    [settings.stt.preset],
  );

  const kept = interviews.filter((i) => i.file.kept);
  const credit = sampleBundle()?.credit ?? t('unit.nasaCredit');

  async function runSttTest(): Promise<TestResult> {
    const started = performance.now();
    const res = await testKey({
      baseUrl: settings.stt.baseUrl,
      key: settings.stt.key,
      model: settings.stt.model,
      lang: 'auto',
      provider: sttProvider,
    });
    if (res.ok) return { ok: true, seconds: (performance.now() - started) / 1000 };

    // §4.4: "Test errors reported verbatim-but-humane: status code + provider's
    // message, one line, no stack traces." WP1 hands back a *code* plus a
    // developer-facing detail, so the two named failures borrow the sentences
    // §4.3 already wrote for them, and the HTTP status is pulled out of the
    // detail rather than invented.
    const status = /(\d{3})/.exec(res.detail ?? '')?.[1] ?? '—';
    if (res.code === 'keyRefused') {
      return { ok: false, status, message: t('bring.keyRefused', { provider: sttProvider }) };
    }
    if (res.code === 'offline') {
      return { ok: false, status, message: t('bring.offline') };
    }
    return { ok: false, status, message: res.detail ?? res.code ?? '' };
  }

  return (
    <>
      <header className="topbar">
        <a className="topbar__name" href={href('library')}>{t('app.name')}</a>
        <span className="topbar__spacer" />
        <a className="button button--quiet" href={href('library')}>{t('action.done')}</a>
      </header>

      <main className="screen settings" data-screen="settings">
        <h1 className="screen__title">{t('settings.title')}</h1>

        {/* ------------------------------------------------ 1 · Transcription */}
        <section className="section settings__section" data-section="transcription">
          <h2 className="section__label">{t('settings.transcription')}</h2>
          <KeyField
            idPrefix="stt"
            keyLabel={t('settings.key')}
            presets={STT_PRESETS.map((p) => ({ id: p.id, label: p.label }))}
            value={settings.stt}
            onChange={(patch) => setSettings({ stt: patch })}
            onPreset={(preset) => applySttPreset(preset as typeof settings.stt.preset)}
            onTest={runSttTest}
          />

          {/* v3 B4 (§4.2): course terms and names, one per line, sent as the
              provider's prompt bias so "Dusek" arrives as Dusek the first time. */}
          <div className="field">
            <label className="field__label" htmlFor="stt-vocabulary">{t('settings.vocabulary')}</label>
            <textarea
              id="stt-vocabulary"
              className="input settings__vocab"
              data-testid="stt-vocabulary"
              rows={3}
              spellCheck={false}
              value={settings.stt.vocabulary ?? ''}
              onChange={(e) => setSettings({ stt: { vocabulary: e.target.value } })}
            />
            <p className="secondary settings__why">{t('settings.vocabularyWhy')}</p>
          </div>
        </section>

        {/* --------------------------------------------------------- 2 · Notes */}
        <section className="section settings__section" data-section="notes">
          <h2 className="section__label">{t('settings.notes')}</h2>
          <KeyField
            idPrefix="llm"
            keyLabel={t('settings.key')}
            presets={LLM_PRESETS.map((p) => ({ id: p.id, label: p.label }))}
            value={settings.llm}
            onChange={(patch) => setSettings({ llm: patch })}
            onPreset={(preset) => applyLlmPreset(preset as typeof settings.llm.preset)}
            onTest={() => testChat(settings.llm)}
          />
          {/* §4.4: the one line that keeps "AI notes" from implying the model heard anything. */}
          <p className="settings__why secondary" data-testid="notes-why">{t('settings.notesWhy')}</p>
        </section>

        {/* ------------------------------------------------------ 3 · Language */}
        <section className="section settings__section" data-section="language">
          <h2 className="section__label">{t('settings.language')}</h2>
          <div className="settings__choice" role="radiogroup" aria-label={t('settings.language')}>
            {([['en', t('unit.langEn')], ['zh', t('unit.langZh')]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.ui.lang === value}
                className="settings__option"
                data-selected={settings.ui.lang === value ? 'yes' : 'no'}
                data-value={value}
                onClick={() => setSettings({ ui: { lang: value } })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------------- 4 · Theme */}
        <section className="section settings__section" data-section="theme">
          <h2 className="section__label">{t('settings.theme')}</h2>
          <div className="settings__choice" role="radiogroup" aria-label={t('settings.theme')}>
            {([
              ['system', t('settings.themeSystem')],
              ['paper', t('settings.themePaper')],
              ['ink', t('settings.themeInk')],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.ui.theme === value}
                className="settings__option"
                data-selected={settings.ui.theme === value ? 'yes' : 'no'}
                data-value={value}
                onClick={() => setSettings({ ui: { theme: value } })}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------- 5 · Storage */}
        <section className="section settings__section" data-section="storage">
          <h2 className="section__label">{t('settings.storage')}</h2>

          <p className="settings__line" data-testid="storage-line">
            {t('settings.storageLine', {
              count: interviews.length,
              size: bytes === null ? '…' : formatBytes(bytes),
            })}
          </p>

          {degraded ? (
            <div className="notice" data-testid="storage-degraded">
              <p className="notice__text">{t('settings.storageDegraded')}</p>
            </div>
          ) : null}

          <Toggle
            id="settings-keep"
            checked={settings.ui.keepAudio}
            onChange={(next) => setSettings({ ui: { keepAudio: next } })}
            label={t('bring.keepAudio')}
            hint={t('bring.keepAudioWhy')}
          />

          {kept.length ? (
            <ul className="settings__recordings" data-testid="storage-recordings">
              {kept.map((interview) => (
                <li key={interview.id} className="settings__recording">
                  <span className="settings__recording-title">{interview.title}</span>
                  <button
                    type="button"
                    className="button button--quiet"
                    data-testid={`forget-${interview.id}`}
                    onClick={() => {
                      void forgetAudio(interview.id).then(() => {
                        void audioBytes().then(setBytes);
                        toast.show(t('action.removeRecording'));
                      });
                    }}
                  >
                    {t('action.removeRecording')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* --------------------------------------------------------- 6 · About */}
        <section className="section settings__section" data-section="about">
          <h2 className="section__label">{t('settings.about')}</h2>
          {/* Only the number is tabular — monospacing the word "Version" too
              makes the About block look like a terminal. */}
          <p className="settings__line">{t('app.version', { version: APP_VERSION })}</p>
          <p className="settings__line">{t('settings.aboutLine')}</p>
          {/* NASA must be acknowledged as the source; no NASA insignia is used. */}
          <p className="settings__line secondary" data-testid="nasa-credit">{credit}</p>
          <a className="settings__link" href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
            {t('settings.github')}
          </a>
        </section>
      </main>

      <Toast message={toast.message} onDone={toast.clear} />
    </>
  );
}
