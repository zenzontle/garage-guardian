'use client';

import { useTranslations } from 'next-intl';
import { formatIssue, issueTitle, type FeedbackReport } from '@/lib/feedback/shared';

export function FeedbackPreview({
  draft,
  screenshotCount,
  disabled,
  onDraftChange,
}: {
  draft: FeedbackReport;
  screenshotCount: number;
  disabled: boolean;
  onDraftChange: (draft: FeedbackReport) => void;
}) {
  const t = useTranslations('feedback');
  return (
    <>
      <h3>{issueTitle(draft.description)}</h3>
      <details open>
        <summary>{t('completePreview')}</summary>
        <pre className="feedback-preview">
          {formatIssue(
            draft,
            Array.from({ length: screenshotCount }, () => ''),
          )}
        </pre>
      </details>
      <fieldset className="feedback-diagnostics" disabled={disabled}>
        <legend>{t('diagnostics')}</legend>
        <p className="field-help">{t('redactionHelp')}</p>
        {draft.diagnostics.map((entry, index) => (
          <div className="feedback-diagnostic" key={`${entry.timestamp}-${index}`}>
            <pre>
              {entry.message}
              {entry.stack ? `\n${entry.stack}` : ''}
            </pre>
            <button
              className="button secondary"
              onClick={() => {
                onDraftChange({
                  ...draft,
                  submissionId: crypto.randomUUID(),
                  diagnostics: draft.diagnostics.filter((_, position) => position !== index),
                });
              }}
            >
              {t('removeError', { count: index + 1 })}
            </button>
          </div>
        ))}
        <button
          className="text-link"
          disabled={!draft.diagnostics.length}
          onClick={() => {
            onDraftChange({
              ...draft,
              submissionId: crypto.randomUUID(),
              diagnostics: [],
            });
          }}
        >
          {t('removeAllErrors')}
        </button>
      </fieldset>
    </>
  );
}
