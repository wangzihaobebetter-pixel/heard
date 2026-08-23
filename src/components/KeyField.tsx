/**
 * KeyField — "preset select + secret input + Test" (DESIGN §7 inventory,
 * §4.3 inline block, §4.4 Settings). WP3 owns this file.
 *
 * One component serves both surfaces because they are the same object seen at
 * two zoom levels:
 *   variant="inline"  — Bring §4.3: preset chooser + key + the one-line promise.
 *                       No base URL, no model, no Test; the Listen once button
 *                       is the test.
 *   variant="full"    — Settings §4.4: everything, with base URL under Advanced
 *                       and a Test that actually sends something.
 *
 * The key input is `type="password"` at rest and `type="text"` while focused.
 * That gets "let me check what I pasted" without inventing a show/hide label —
 * WP0 owns the copy and a package does not add strings of its own.
 *
 * DESIGN §10.4 / REVIEW A7: Groq is *offered*, never *recommended*. There is
 * deliberately no "cheaper", no "faster", no badge on any preset in here. Do
 * not add one until browser-direct CORS from the Pages origin is verified.
 */
import { useState } from 'react';
import { useT } from '../i18n';
import './KeyField.css';

export interface PresetOption { id: string; label: string }

export interface KeyFieldValue {
  preset: string;
  baseUrl: string;
  key: string;
  model: string;
}

export type TestResult =
  | { ok: true; seconds: number }
  | { ok: false; status: string; message: string };

export interface KeyFieldProps {
  /** distinguishes the two instances on the Settings screen for label/id wiring */
  idPrefix: string;
  /** the key input's visible label — "Transcription key" inline, "Key" in Settings */
  keyLabel: string;
  /** the one line under the field; §4.3's promise, or nothing in Settings */
  hint?: string;
  presets: PresetOption[];
  value: KeyFieldValue;
  /** Never carries `preset` — the preset chooser goes through `onPreset`, which
      also resets base URL and model. Narrowing it here keeps the callers'
      union-typed preset fields intact without a cast. */
  onChange: (patch: Partial<Omit<KeyFieldValue, 'preset'>>) => void;
  onPreset: (preset: string) => void;
  /** absent in the inline variant */
  onTest?: () => Promise<TestResult>;
  variant?: 'inline' | 'full';
}

export default function KeyField({
  idPrefix, keyLabel, hint, presets, value, onChange, onPreset, onTest, variant = 'full',
}: KeyFieldProps) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const full = variant === 'full';

  async function runTest() {
    if (!onTest || testing) return;
    setTesting(true);
    setResult(null);
    try {
      setResult(await onTest());
    } catch (err) {
      // A thrown error is still an answer; §4.4 wants "status code + provider's
      // message, one line, no stack traces".
      setResult({ ok: false, status: '—', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="keyfield" data-variant={variant}>
      <div className="keyfield__presets" role="radiogroup" aria-label={t('settings.provider')}>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={value.preset === p.id}
            className="keyfield__preset"
            data-selected={value.preset === p.id ? 'yes' : 'no'}
            data-preset={p.id}
            onClick={() => onPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="keyfield__row">
        <label className="keyfield__label micro" htmlFor={`${idPrefix}-key`}>{keyLabel}</label>
        <input
          id={`${idPrefix}-key`}
          className="keyfield__input"
          data-testid={`${idPrefix}-key`}
          type={revealed ? 'text' : 'password'}
          value={value.key}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onFocus={() => setRevealed(true)}
          onBlur={() => setRevealed(false)}
          onChange={(e) => onChange({ key: e.target.value })}
        />
      </div>

      {full ? (
        <div className="keyfield__row">
          <label className="keyfield__label micro" htmlFor={`${idPrefix}-model`}>{t('settings.model')}</label>
          <input
            id={`${idPrefix}-model`}
            className="keyfield__input tabular"
            data-testid={`${idPrefix}-model`}
            type="text"
            value={value.model}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onChange({ model: e.target.value })}
          />
        </div>
      ) : null}

      {full ? (
        <div className="keyfield__advanced">
          <button
            type="button"
            className="keyfield__disclosure micro"
            aria-expanded={advanced}
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? '−' : '+'} {t('action.advanced')}
          </button>
          {advanced ? (
            <div className="keyfield__row">
              <label className="keyfield__label micro" htmlFor={`${idPrefix}-base`}>{t('settings.baseUrl')}</label>
              <input
                id={`${idPrefix}-base`}
                className="keyfield__input"
                data-testid={`${idPrefix}-base`}
                type="url"
                value={value.baseUrl}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {hint ? <p className="keyfield__hint secondary">{hint}</p> : null}

      {onTest ? (
        <div className="keyfield__test">
          <button
            type="button"
            className="button button--secondary"
            data-testid={`${idPrefix}-test`}
            disabled={testing}
            onClick={runTest}
          >
            {t('action.test')}
          </button>
          <span className="keyfield__result secondary" data-testid={`${idPrefix}-test-result`} aria-live="polite">
            {testing ? t('settings.testRunning') : null}
            {!testing && result?.ok ? t('settings.testOk', { seconds: result.seconds.toFixed(1) }) : null}
            {!testing && result && !result.ok
              ? t('settings.testFail', { status: result.status, message: result.message })
              : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
