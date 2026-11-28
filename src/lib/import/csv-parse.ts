// Larger files are almost certainly not a garage log, and parsing them would stall the page.
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/**
 * Parses RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks; CRLF, LF,
 * and CR all end a record. A leading byte order mark is ignored and blank lines are skipped.
 * The delimiter is the first comma, semicolon, or tab found outside quotes on the header line,
 * so spreadsheets saved with a regional list separator also read correctly.
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  const endRecord = () => {
    row.push(field);
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
    field = '';
  };
  while (index < source.length) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else field += char;
      index++;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      endRecord();
      if (char === '\r' && source[index + 1] === '\n') index++;
    } else field += char;
    index++;
  }
  if (field !== '' || row.length) endRecord();
  return rows;
}

function detectDelimiter(source: string): string {
  let quoted = false;
  for (const char of source) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === ';' || char === '\t')) return char;
    else if (!quoted && (char === '\n' || char === '\r')) break;
  }
  return ',';
}

/**
 * Undoes the export's spreadsheet formula guard: exported text that starts with =, +, -, @, tab,
 * or carriage return is prefixed with an apostrophe, which is not part of the saved value.
 */
export const unguardCell = (value: string) =>
  /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
