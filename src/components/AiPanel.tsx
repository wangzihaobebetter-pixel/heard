/**
 * AiPanel — summary, chapters, concepts, exam flags, every claim wearing its
 * receipt (v3 B5, PRODUCT-SPEC §4.4: "an uncited summary is decoration").
 *
 * The chip is the whole design: [n] in the summary, a timecode on a chapter,
 * a ⌁ on a concept — press any of them and the tape plays that moment. This
 * panel never renders AI text as if it were the user's: it is visibly the
 * machine's reading of the tape, checkable in one press.
 */
import { Fragment, useState } from 'react';
import type { Citation, StarterArtifacts } from '../content/schema';
import type { PromptResult, SummaryStyle } from '../ai/artifacts';
import { formatTimecode } from '../lib/time';
import { useT } from '../i18n';
import './AiPanel.css';

export interface AiPanelProps {
  artifacts: StarterArtifacts | null;
  status: 'ready' | 'none' | 'no-key' | 'generating' | 'failed';
  /** whether this recording can generate (transcript present, not a starter) */
  canGenerate: boolean;
  onCite: (c: Citation) => void;
  onGenerate: (style?: SummaryStyle) => void;
  onConnect: () => void;
  /** v3 B12 (§4.4): saved prompts — presets + the user's own, re-runnable */
  prompts: string[];
  canAsk: boolean;
  promptBusy: boolean;
  promptResult: { prompt: string; result: PromptResult } | null;
  onRunPrompt: (prompt: string) => void;
  onSavePrompt: (prompt: string) => void;
}

/** Summary text with its [n] markers rendered as pressable citation chips. */
function SummaryText({ text, citations, onCite }: {
  text: string;
  citations: (Citation | null)[];
  onCite: (c: Citation) => void;
}) {
  return (
    <>
      {text.split(/\n\n+/).map((para, p) => (
        <p className="ai__para" key={p}>
          {para.split(/(\[\d+\])/).map((part, k) => {
            const m = /^\[(\d+)\]$/.exec(part);
            if (!m) return <Fragment key={k}>{part}</Fragment>;
            const cite = citations[Number(m[1]) - 1];
            // A citation that failed verification keeps its marker as plain
            // text — the claim stays readable, it just cannot pretend to a
            // moment it could not prove.
            if (!cite) return <Fragment key={k}>{part}</Fragment>;
            return (
              <button type="button" key={k} className="ai__cite timecode" onClick={() => onCite(cite)}>
                {m[1]}
              </button>
            );
          })}
        </p>
      ))}
    </>
  );
}

export default function AiPanel({
  artifacts, status, canGenerate, onCite, onGenerate, onConnect,
  prompts, canAsk, promptBusy, promptResult, onRunPrompt, onSavePrompt,
}: AiPanelProps) {
  const t = useT();
  const [style, setStyle] = useState<SummaryStyle>('concise');
  const [draft, setDraft] = useState('');

  /* §4.4 saved prompts: pressable on any transcribed recording; the answer
     wears the same citation chips as everything else. Rendered in both the
     ready state and (for generated-capable recordings) beneath the state
     card, so a recording without a summary can still be asked. */
  const promptBlock = canAsk ? (
    <section className="ai__section" data-testid="ai-prompts">
      <h2 className="micro ai__label">{t('ai.prompts')}</h2>
      <div className="ai__prompt-row">
        {prompts.map((pr) => (
          <button
            key={pr}
            type="button"
            className="ai__prompt"
            disabled={promptBusy}
            onClick={() => onRunPrompt(pr)}
          >
            {pr}
          </button>
        ))}
      </div>
      <div className="ai__prompt-add">
        <input
          className="input"
          data-testid="ai-prompt-input"
          type="text"
          placeholder={t('ai.promptPlaceholder')}
          value={draft}
          disabled={promptBusy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) { onRunPrompt(draft.trim()); onSavePrompt(draft.trim()); setDraft(''); }
          }}
        />
      </div>
      {promptBusy ? <p className="secondary">{t('ai.asking')}</p> : null}
      {promptResult && !promptBusy ? (
        <div className="ai__answer" data-testid="ai-answer">
          <p className="micro ai__label">{promptResult.prompt}</p>
          <SummaryText text={promptResult.result.answer} citations={promptResult.result.citations} onCite={onCite} />
        </div>
      ) : null}
    </section>
  ) : null;

  const styleRow = canGenerate ? (
    <div className="ai__styles" data-testid="ai-styles">
      {(['concise', 'detailed', 'study'] as const).map((s) => (
        <button
          key={s}
          type="button"
          className="modechip"
          aria-pressed={style === s}
          onClick={() => setStyle(s)}
        >
          {t(`ai.style_${s}`)}
        </button>
      ))}
    </div>
  ) : null;

  if (status !== 'ready' || !artifacts) {
    return (
      <div className="ai__state card-note" data-testid="ai-state" data-status={status}>
        {status === 'generating' ? <p>{t('ai.generating')}</p> : null}
        {status === 'failed' ? <p>{t('ai.failed')}</p> : null}
        {status === 'no-key' ? (
          <>
            <p>{t('ai.connectWhy')}</p>
            <button type="button" className="btn btn--secondary" data-testid="ai-connect" onClick={onConnect}>
              {t('ai.connectCta')}
            </button>
          </>
        ) : null}
        {status === 'none' ? (
          canGenerate ? (
            <>
              <p>{t('ai.generateWhy')}</p>
              {styleRow}
              <button type="button" className="btn btn--secondary" data-testid="ai-generate" onClick={() => onGenerate(style)}>
                {t('ai.generate')}
              </button>
            </>
          ) : <p>{t('ai.notYet')}</p>
        ) : null}
        {promptBlock}
      </div>
    );
  }

  const { summary, chapters, concepts, flags } = artifacts;
  return (
    <div className="ai" data-testid="ai-panel">
      {summary.text ? (
        <section className="ai__section" data-testid="ai-summary">
          <h2 className="micro ai__label">{t('ai.summary')}</h2>
          <SummaryText text={summary.text} citations={summary.citations} onCite={onCite} />
        </section>
      ) : null}

      {chapters.length ? (
        <section className="ai__section" data-testid="ai-chapters">
          <h2 className="micro ai__label">{t('ai.chapters')}</h2>
          <ol className="ai__chapters">
            {chapters.map((c, k) => (
              <li key={k}>
                <button type="button" className="ai__chapter" onClick={() => onCite(c.at)}>
                  <span className="tc timecode">{formatTimecode(c.at.s)}</span>
                  <span className="ai__chapter-title">{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {concepts.length ? (
        <section className="ai__section" data-testid="ai-concepts">
          <h2 className="micro ai__label">{t('ai.concepts')}</h2>
          {concepts.map((c, k) => (
            <div className="ai__concept" key={k}>
              <p className="ai__term">
                {c.term}
                <button type="button" className="tc timecode ai__term-tc" onClick={() => onCite(c.cite)}>
                  {formatTimecode(c.cite.s)}
                </button>
              </p>
              <p className="ai__def secondary">{c.definition}</p>
            </div>
          ))}
        </section>
      ) : null}

      {flags.length ? (
        <section className="ai__section" data-testid="ai-flags">
          <h2 className="micro ai__label">{t('ai.flags')}</h2>
          {flags.map((f, k) => (
            <button type="button" className="ai__flag" key={k} onClick={() => onCite(f.cite)}>
              <span className="tc timecode">{formatTimecode(f.cite.s)}</span>
              <span>{f.text}</span>
            </button>
          ))}
        </section>
      ) : null}

      {promptBlock}

      {canGenerate ? (
        <div className="ai__regen-row">
          {styleRow}
          <button type="button" className="btn btn--quiet ai__regen" data-testid="ai-regenerate" onClick={() => onGenerate(style)}>
            {t('ai.regenerate')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
