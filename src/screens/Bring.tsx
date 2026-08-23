/**
 * Bring `#/add` (DESIGN §4.3). WP3 owns this screen.
 *
 * "One screen from file to listening." Everything here is subordinate to that:
 * the file, the title, the language, one toggle, the key if there isn't one
 * yet, and the button. Nothing is collapsed behind a step-2.
 *
 * The refusals are the interesting part, and they are refusals *before* the
 * work starts rather than errors after it:
 *   · a file we cannot read              → bring.unsupported
 *   · longer than three hours            → bring.tooLong
 *   · too big for this device to decode  → bring.tooBigMobile (with the size)
 *   · a key the provider will not accept → bring.keyRefused (with the provider)
 *   · no network                         → bring.offline
 *
 * The key check is a real round trip (WP1's `testKey`, one second of silence)
 * issued when **Listen once** is pressed. §4.3 says a refused key leaves the
 * field focused and "nothing else changes" — which is only possible if we find
 * out before navigating away. It costs about half a second and it is the
 * difference between a refusal and a broken interview.
 *
 * Size/duration/decodability all come from WP1 (`planIntake`, `probeDuration`,
 * `EngineError`): the engine returns *codes*, this screen owns the sentences.
 */
import { useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { href, replace } from '../router';
import { useStore } from '../store';
import { ACCEPTED_EXT, MAX_DURATION_SEC, STT_PRESETS } from '../store/presets';
import { putAudio } from '../lib/storage';
import { formatBytes, formatDuration } from '../lib/time';
import { EngineError, planIntake, probeDuration } from '../audio/decode';
import { testKey } from '../audio/transcribe';
import DropZone from '../components/DropZone';
import KeyField from '../components/KeyField';
import Toggle from '../components/Toggle';
import '../components/ui.css';
import './Bring.css';

/**
 * "Auto / English / 中文 / … ISO list" (§4.3). Auto, English and 中文 are UI
 * copy and come from the string table; the rest are endonyms — a language's own
 * name for itself is the same word in an English UI and a Chinese one, so it is
 * data, not copy, and WP0's table is not the place for it.
 */
const MORE_LANGS: { code: string; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية' },
];

type Refusal =
  | { kind: 'tooBigMobile'; size: string }
  | { kind: 'tooLong' }
  | { kind: 'unsupported' }
  | { kind: 'keyRefused'; provider: string }
  | { kind: 'offline' }
  | { kind: 'other'; status: string; message: string };

interface Chosen {
  file: File;
  durationSec: number;
}

/** `2026-08-14 board meeting.m4a` → `2026-08-14 board meeting`. */
function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || name;
}

function extensionOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export default function Bring() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const applySttPreset = useStore((s) => s.applySttPreset);
  const createInterview = useStore((s) => s.createInterview);

  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [title, setTitle] = useState('');
  const [lang, setLang] = useState<'auto' | string>('auto');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const keyBlockRef = useRef<HTMLDivElement>(null);

  // §4.3: the key block appears inline only when there isn't one saved yet.
  const keyMissing = !settings.stt.key.trim();

  const providerLabel = useMemo(() => {
    const preset = STT_PRESETS.find((p) => p.id === settings.stt.preset);
    if (preset && preset.id !== 'custom') return preset.label;
    try { return new URL(settings.stt.baseUrl).hostname; } catch { return settings.stt.baseUrl || 'the provider'; }
  }, [settings.stt.preset, settings.stt.baseUrl]);

  function clear() {
    setChosen(null);
    setRefusal(null);
  }

  async function onFile(file: File) {
    setRefusal(null);
    setChosen(null);

    if (!ACCEPTED_EXT.includes(extensionOf(file.name) as typeof ACCEPTED_EXT[number])) {
      setRefusal({ kind: 'unsupported' });
      return;
    }

    let durationSec = 0;
    try {
      durationSec = await probeDuration(file);
    } catch {
      // The browser could not even read its metadata; nothing else we try will
      // work either, and "I can't read that kind of file" is the honest line.
      setRefusal({ kind: 'unsupported' });
      return;
    }

    if (durationSec > MAX_DURATION_SEC) {
      setRefusal({ kind: 'tooLong' });
      return;
    }

    try {
      planIntake(file.size, durationSec);
    } catch (err) {
      if (err instanceof EngineError && (err.code === 'tooBigMobile' || err.code === 'tooBig')) {
        // Both ceilings speak with the same sentence: it is the one that names
        // the number and both limits. (`tooBig` — over 400 MB on a laptop — has
        // no line of its own in §4.3; flagged to the design owner rather than
        // invented here.)
        setRefusal({ kind: 'tooBigMobile', size: formatBytes(file.size) });
        return;
      }
      setRefusal({ kind: 'unsupported' });
      return;
    }

    setChosen({ file, durationSec });
    setTitle(titleFromFilename(file.name));
  }

  async function listenOnce() {
    if (!chosen || busy) return;
    setRefusal(null);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setRefusal({ kind: 'offline' });
      return;
    }

    setBusy(true);
    try {
      const probe = await testKey({
        baseUrl: settings.stt.baseUrl,
        key: settings.stt.key,
        model: settings.stt.model,
        lang,
        provider: providerLabel,
      });

      if (!probe.ok) {
        if (probe.code === 'keyRefused') {
          setRefusal({ kind: 'keyRefused', provider: providerLabel });
          // §4.3: "field focused, nothing else changes".
          keyBlockRef.current?.querySelector('input')?.focus();
          return;
        }
        if (probe.code === 'offline') {
          setRefusal({ kind: 'offline' });
          return;
        }
        setRefusal({ kind: 'other', status: probe.code ?? '—', message: probe.detail ?? '' });
        return;
      }

      const interview = createInterview({
        title: title.trim() || titleFromFilename(chosen.file.name),
        durationSec: chosen.durationSec,
        recordedAt: chosen.file.lastModified || undefined,
        lang,
        status: 'listening',
        file: {
          name: chosen.file.name,
          size: chosen.file.size,
          type: chosen.file.type,
          kept: settings.ui.keepAudio,
        },
      });

      if (settings.ui.keepAudio) {
        // Always awaited: the Interview screen resolves playback from this blob,
        // and arriving before the write lands is the "recording isn't on this
        // device" state appearing for a recording that is.
        await putAudio(interview.id, chosen.file);
      }

      // §4.3: "on press, navigate straight to #/i/:newId … do not sit on this
      // screen." `replace`, not `navigate`, so Back does not come back here.
      replace('interview', { id: interview.id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <a className="topbar__name" href={href('library')}>{t('app.name')}</a>
        <span className="topbar__spacer" />
        <a className="iconbutton" href={href('settings')} aria-label={t('settings.title')}>⚙</a>
      </header>

      <main className="screen bring" data-screen="bring">
        <h1 className="screen__title">{t('bring.title')}</h1>

        {!chosen ? (
          <DropZone onFile={onFile} label={t('bring.choose')} hint={t('bring.dropHint')} disabled={busy} />
        ) : (
          <div className="bring__file" data-testid="bring-file">
            <div className="bring__file-text">
              <p className="bring__filename">{chosen.file.name}</p>
              <p className="bring__filemeta secondary">
                <span>{formatBytes(chosen.file.size)}</span>
                <span aria-hidden="true"> · </span>
                <span className="tabular" data-testid="bring-duration">{formatDuration(chosen.durationSec)}</span>
              </p>
            </div>
            <button type="button" className="button button--quiet bring__change" onClick={clear}>
              {t('action.chooseAnother')}
            </button>
          </div>
        )}

        {refusal ? (
          <div className="notice" data-testid="bring-refusal" data-refusal={refusal.kind}>
            <p className="notice__text">
              {refusal.kind === 'tooBigMobile' ? t('bring.tooBigMobile', { size: refusal.size }) : null}
              {refusal.kind === 'tooLong' ? t('bring.tooLong') : null}
              {refusal.kind === 'unsupported' ? t('bring.unsupported') : null}
              {refusal.kind === 'keyRefused' ? t('bring.keyRefused', { provider: refusal.provider }) : null}
              {refusal.kind === 'offline' ? t('bring.offline') : null}
              {refusal.kind === 'other' ? t('settings.testFail', { status: refusal.status, message: refusal.message }) : null}
            </p>
            {refusal.kind === 'tooBigMobile' || refusal.kind === 'tooLong' || refusal.kind === 'unsupported' ? (
              <button type="button" className="button button--secondary" onClick={clear}>
                {t('action.chooseAnother')}
              </button>
            ) : null}
          </div>
        ) : null}

        {chosen ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor="bring-title">{t('bring.fieldTitle')}</label>
              <input
                id="bring-title"
                className="input"
                data-testid="bring-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="bring-lang">{t('bring.fieldLanguage')}</label>
              <select
                id="bring-lang"
                className="select"
                data-testid="bring-lang"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
              >
                <option value="auto">{t('unit.langAuto')}</option>
                <option value="en">{t('unit.langEn')}</option>
                <option value="zh">{t('unit.langZh')}</option>
                {MORE_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>

            <Toggle
              id="bring-keep"
              checked={settings.ui.keepAudio}
              onChange={(next) => setSettings({ ui: { keepAudio: next } })}
              label={t('bring.keepAudio')}
              hint={t('bring.keepAudioWhy')}
            />
          </>
        ) : null}

        {keyMissing ? (
          <div className="bring__key" ref={keyBlockRef} data-testid="bring-key">
            <KeyField
              idPrefix="bring-stt"
              variant="inline"
              keyLabel={t('bring.keyLabel')}
              hint={t('bring.keyWhy')}
              presets={STT_PRESETS.map((p) => ({ id: p.id, label: p.label }))}
              value={settings.stt}
              onChange={(patch) => setSettings({ stt: patch })}
              onPreset={(preset) => applySttPreset(preset as typeof settings.stt.preset)}
            />
          </div>
        ) : null}

        <div className="bring__go">
          <button
            type="button"
            className="button button--primary button--wide"
            data-testid="bring-listen"
            disabled={!chosen || busy || !settings.stt.key.trim()}
            onClick={listenOnce}
          >
            {t('action.listenOnce')}
          </button>
          <p className="bring__estimate secondary">{t('bring.estimate')}</p>
        </div>
      </main>
    </>
  );
}
