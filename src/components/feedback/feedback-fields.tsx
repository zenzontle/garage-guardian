'use client';

import { useTranslations } from 'next-intl';

export function FeedbackFields({
  description,
  onDescriptionChange,
  onChooseFiles,
}: {
  description: string;
  onDescriptionChange: (description: string) => void;
  onChooseFiles: (files: FileList | null) => void;
}) {
  const t = useTranslations('feedback');
  return (
    <>
      <label htmlFor="feedback-description">{t('description')}</label>
      <textarea
        id="feedback-description"
        aria-describedby="feedback-description-example feedback-report-contents"
        rows={7}
        value={description}
        minLength={10}
        maxLength={5000}
        onChange={(event) => onDescriptionChange(event.target.value)}
      />
      <p id="feedback-description-example" className="field-help">
        {t('descriptionExample')}
      </p>
      <p id="feedback-report-contents" className="feedback-report-contents">
        {t('reportContents')}
      </p>
      <label htmlFor="feedback-screenshots">{t('screenshots')}</label>
      <input
        id="feedback-screenshots"
        aria-describedby="feedback-file-help"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(event) => {
          onChooseFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <p id="feedback-file-help" className="field-help">
        {t('fileHelp')}
      </p>
    </>
  );
}
