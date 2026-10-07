'use client';

import { useTranslations } from 'next-intl';

export function BugReportFields({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  onChooseFiles,
}: {
  title: string;
  description: string;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onChooseFiles: (files: FileList | null) => void;
}) {
  const t = useTranslations('bugReports');
  return (
    <>
      <label>
        {t('title')}
        <input
          value={title}
          minLength={5}
          maxLength={120}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      <label>
        {t('description')}
        <textarea
          rows={7}
          value={description}
          minLength={10}
          maxLength={5000}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder={t('descriptionPrompt')}
        />
      </label>
      <label htmlFor="bug-report-screenshots">{t('screenshots')}</label>
      <input
        id="bug-report-screenshots"
        aria-describedby="bug-report-file-help"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(event) => {
          onChooseFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <p id="bug-report-file-help" className="field-help">
        {t('fileHelp')}
      </p>
    </>
  );
}
