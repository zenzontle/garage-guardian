'use client';

import { useTranslations } from 'next-intl';
import { formatIssue, issueTitle, type BugReport } from '@/lib/bug-reports/shared';

export function BugReportPreview({
  draft,
  screenshotCount,
  disabled,
  onDraftChange,
}: {
  draft: BugReport;
  screenshotCount: number;
  disabled: boolean;
  onDraftChange: (draft: BugReport) => void;
}) {
  const t = useTranslations('bugReports');
  return (
    <>
      <h3>{issueTitle(draft.title)}</h3>
      <details open>
        <summary>{t('completePreview')}</summary>
        <pre className="bug-report-preview">
          {formatIssue(
            draft,
            Array.from({ length: screenshotCount }, () => ''),
          )}
        </pre>
      </details>
      <fieldset className="bug-report-diagnostics" disabled={disabled}>
        <legend>{t('diagnostics')}</legend>
        <p className="field-help">{t('redactionHelp')}</p>
        {draft.diagnostics.map((entry, index) => (
          <div className="bug-report-diagnostic" key={`${entry.timestamp}-${index}`}>
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
