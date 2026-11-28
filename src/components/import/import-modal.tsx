'use client';

import { useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { activeCarsFirst, newId, type Car, type Snapshot } from '@/lib/garage/model';
import type { Currency } from '@/lib/currency/currency';
import { MAX_IMPORT_BYTES, parseCsv } from '@/lib/import/csv-parse';
import {
  autoMap,
  buildImportPreview,
  detectDateOrder,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  recordsToImport,
  REQUIRED_FIELDS,
  type DateOrder,
  type ImportField,
  type ImportIssue,
  type ImportKind,
  type ImportMapping,
  type ImportRecord,
  type ImportRow,
} from '@/lib/import/import';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { todayISO } from '@/lib/utils/today-iso';
import { Modal } from '../ui/modal';
import { CarOptions, CurrencyOptions } from '../ui/select-options';
import { useFormInteraction } from '../interaction/use-form-interaction';

// Enough rows to see what needs fixing without rendering a whole log.
const PROBLEM_LIMIT = 50;

type LoadedFile = { name: string; table: string[][] };
type FileProblem = 'fileTooLarge' | 'fileUnreadable' | 'fileEmpty';

export function ImportModal<K extends ImportKind>({
  kind,
  carId,
  snapshot,
  homeCurrency = 'USD',
  onClose,
  onImport,
}: {
  kind: K;
  /** The vehicle filtered on the page, if any, preselected for files without a car column. */
  carId?: string;
  snapshot: Snapshot;
  homeCurrency?: Currency;
  onClose: () => void;
  /** Saves the records in order, reporting each one saved. */
  onImport: (records: ImportRecord[K][], onSaved: (count: number) => void) => Promise<void>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const cars: Car[] = activeCarsFirst(snapshot.cars);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileProblem, setFileProblem] = useState<FileProblem | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [carChoice, setCarChoice] = useState('');
  const [currency, setCurrency] = useState<Currency>(homeCurrency);
  const localeOrder: DateOrder = locale === 'es' ? 'dmy' : 'mdy';
  const [dateOrder, setDateOrder] = useState<DateOrder>(localeOrder);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ count: number; total: number } | null>(null);
  const [formError, setFormError] = useState<AppFailure | null>(null);
  const loadedAt = useRef(0);
  const interaction = useFormInteraction(
    { file: file?.name ?? null, mapping, carChoice, currency, dateOrder, includeDuplicates },
    { busy },
  );
  const close = () => interaction.request(onClose);
  const fileHint = useId();
  const summaryId = useId();

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    setFileProblem(null);
    setFormError(null);
    setSaved(null);
    if (!chosen) return;
    if (chosen.size > MAX_IMPORT_BYTES) {
      setFile(null);
      setFileProblem('fileTooLarge');
      return;
    }
    let table: string[][];
    try {
      table = parseCsv(await chosen.text());
    } catch {
      setFile(null);
      setFileProblem('fileUnreadable');
      return;
    }
    if (table.length < 2) {
      setFile(null);
      setFileProblem(table.length ? 'fileEmpty' : 'fileUnreadable');
      return;
    }
    const detected = autoMap(kind, table[0]);
    loadedAt.current = Date.now();
    setFile({ name: chosen.name, table });
    setMapping(detected);
    setIncludeDuplicates(false);
    // Files without a vehicle column go to the page's vehicle, or the first active one.
    setCarChoice(
      detected.car !== undefined
        ? ''
        : (cars.find((car) => car.id === carId)?.id ??
            cars.find((car) => !car.isArchived)?.id ??
            ''),
    );
    const dates =
      detected.date === undefined ? [] : table.slice(1).map((row) => row[detected.date!] ?? '');
    // Each file is read on its own: a previous file's order is not carried over.
    setDateOrder(detectDateOrder(dates) ?? localeOrder);
  }

  const preview = useMemo(
    () =>
      file
        ? buildImportPreview(kind, file.table, mapping, snapshot, {
            carId: carChoice || null,
            currency,
            dateOrder,
            today: todayISO(),
            now: loadedAt.current,
            newId,
          })
        : null,
    [file, kind, mapping, snapshot, carChoice, currency, dateOrder],
  );
  const records = preview ? recordsToImport(preview, includeDuplicates) : [];
  const fields: readonly ImportField[] = IMPORT_FIELDS[kind];
  const missing = [
    ...(!carChoice && mapping.car === undefined ? (['car'] as const) : []),
    ...REQUIRED_FIELDS[kind].filter((field) => mapping[field] === undefined),
  ];
  const problems = preview
    ? preview.rows.filter((row) => row.status !== 'ready' || row.issues.length)
    : [];

  function issueText(issue: ImportIssue) {
    const values = { ...issue.values };
    if (typeof values.field === 'string')
      values.field = t(`import.fields.${values.field as ImportField}`);
    return t(`import.issues.${issue.code}`, values);
  }
  function rowMessages(row: ImportRow<unknown>) {
    const messages = row.issues.map(issueText);
    if (row.status === 'duplicate') messages.push(t('import.duplicateRow'));
    return messages;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!records.length || missing.length || !interaction.begin()) return;
    setBusy(true);
    setSaved({ count: 0, total: records.length });
    try {
      await onImport(records, (count) => setSaved({ count, total: records.length }));
      interaction.accept();
    } catch (cause) {
      setFormError(failureOf(cause, 'save'));
    } finally {
      interaction.end();
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t(`import.title.${kind as ImportKind}`)}
      subtitle={t('import.subtitle')}
      onClose={close}
      busy={busy}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset className="interaction-fields" disabled={busy}>
          <div className="modal-body form-stack">
            <label>
              {t('import.file')}
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => void chooseFile(event)}
                aria-describedby={fileHint}
              />
            </label>
            <p className="section-hint" id={fileHint}>
              {t('import.fileHint')}
            </p>
            {fileProblem && (
              <p className="error-text" role="alert">
                {t(`import.${fileProblem}`, { size: '2 MB' })}
              </p>
            )}
            {file && preview && (
              <>
                <div className="form-grid">
                  <label>
                    {t('import.vehicle')}
                    <select value={carChoice} onChange={(e) => setCarChoice(e.target.value)}>
                      <option value="" disabled={mapping.car === undefined}>
                        {t('import.vehicleFromFile')}
                      </option>
                      <CarOptions cars={cars} />
                    </select>
                  </label>
                  <label>
                    {t('import.currency')}
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value as Currency)}
                    >
                      <CurrencyOptions />
                    </select>
                  </label>
                </div>
                <label>
                  {t('import.dateOrder')}
                  <select
                    value={dateOrder}
                    onChange={(event) => setDateOrder(event.target.value as DateOrder)}
                  >
                    {(['mdy', 'dmy', 'ymd'] as const).map((order) => (
                      <option key={order} value={order}>
                        {t(`import.dateOrders.${order}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <details className="import-columns" open={missing.length > 0}>
                  <summary>{t('import.columns')}</summary>
                  <p className="section-hint">{t('import.columnsHint')}</p>
                  <div className="form-grid">
                    {fields.map((field) => (
                      <label key={field}>
                        <span className="field-label">
                          {t(`import.fields.${field}`)}
                          {(REQUIRED_FIELDS[kind].includes(field) ||
                            (field === 'car' && !carChoice)) && (
                            <span className="optional"> {t('import.required')}</span>
                          )}
                        </span>
                        <select
                          value={mapping[field] ?? ''}
                          onChange={(event) => {
                            const column = event.target.value;
                            setMapping((current) => {
                              const next = { ...current };
                              // A column feeds one field, so choosing it elsewhere moves it.
                              for (const key of Object.keys(next) as ImportField[])
                                if (String(next[key]) === column) delete next[key];
                              if (column === '') delete next[field];
                              else next[field] = Number(column);
                              return next;
                            });
                          }}
                        >
                          <option value="">{t('import.notInFile')}</option>
                          {file.table[0].map((header, index) => (
                            <option key={index} value={index}>
                              {header.trim() || t('import.unnamedColumn', { number: index + 1 })}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
                {missing.length > 0 && (
                  <p className="error-text" role="alert">
                    {t('import.missingRequired', {
                      fields: missing.map((field) => t(`import.fields.${field}`)).join(', '),
                    })}
                  </p>
                )}
                <dl className="import-summary" id={summaryId} aria-live="polite">
                  <div>
                    <dt>{t('import.ready')}</dt>
                    <dd>{preview.ready}</dd>
                  </div>
                  <div>
                    <dt>{t('import.duplicates')}</dt>
                    <dd>{preview.duplicates}</dd>
                  </div>
                  <div>
                    <dt>{t('import.errors')}</dt>
                    <dd>{preview.errors}</dd>
                  </div>
                </dl>
                {preview.skipped > 0 && (
                  <p className="section-hint">
                    {t('import.skipped', { max: MAX_IMPORT_ROWS, count: preview.skipped })}
                  </p>
                )}
                {preview.duplicates > 0 && (
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={includeDuplicates}
                      onChange={(event) => setIncludeDuplicates(event.target.checked)}
                    />
                    {t('import.includeDuplicates')}
                  </label>
                )}
                {problems.length > 0 && (
                  <section className="import-problems" aria-label={t('import.problems')}>
                    <h3>{t('import.problems')}</h3>
                    <ul role="list" tabIndex={0}>
                      {problems.slice(0, PROBLEM_LIMIT).map((row) => (
                        <li key={row.line}>
                          <span className={`status-pill import-${row.status}`}>
                            {t('import.row', { line: row.line })}
                          </span>
                          <span>{rowMessages(row).join(' ')}</span>
                        </li>
                      ))}
                    </ul>
                    {problems.length > PROBLEM_LIMIT && (
                      <p className="section-hint">
                        {t('import.moreProblems', { count: problems.length - PROBLEM_LIMIT })}
                      </p>
                    )}
                  </section>
                )}
              </>
            )}
            {busy && saved && (
              <p role="status">
                {t('import.saving', { current: saved.count, total: saved.total })}
              </p>
            )}
            {formError && (
              <p className="error-text" role="alert">
                {t(`errors.${formError.code}`, formError.values)}
                {saved && saved.count > 0 && ` ${t('import.partial', saved)}`}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="button secondary" onClick={close}>
              {t('shared.cancel')}
            </button>
            <button
              className="button primary"
              disabled={busy || !records.length || missing.length > 0}
              aria-describedby={preview ? summaryId : undefined}
            >
              {busy ? t('shared.saving') : t('import.submit', { count: records.length })}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
