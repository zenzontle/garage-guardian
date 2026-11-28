import { describe, expect, it } from 'vitest';
import { parseCsv, unguardCell } from './csv-parse';

describe('parseCsv', () => {
  it('reads quoted fields with commas, quotes, and line breaks', () => {
    expect(parseCsv('a,b,c\r\n"1,5","say ""hi""","two\nlines"\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1,5', 'say "hi"', 'two\nlines'],
    ]);
  });

  it('ignores a byte order mark and blank lines, and keeps empty fields', () => {
    expect(parseCsv('﻿Date,Notes\n\n2026-01-02,\n,\n')).toEqual([
      ['Date', 'Notes'],
      ['2026-01-02', ''],
      ['', ''],
    ]);
  });

  it('reads the last record without a trailing line break, and lone CR line endings', () => {
    expect(parseCsv('a\rb\rc')).toEqual([['a'], ['b'], ['c']]);
  });

  it.each([
    ['semicolons', 'Fecha;Total\n2026-01-02;12.50'],
    ['tabs', 'Fecha\tTotal\n2026-01-02\t12.50'],
  ])('detects %s as the delimiter from the header line', (_, text) => {
    expect(parseCsv(text)).toEqual([
      ['Fecha', 'Total'],
      ['2026-01-02', '12.50'],
    ]);
  });

  it('ignores delimiters inside a quoted header when detecting', () => {
    expect(parseCsv('"Cost; total",Date\n1,2')).toEqual([
      ['Cost; total', 'Date'],
      ['1', '2'],
    ]);
  });
});

describe('unguardCell', () => {
  it('removes the export formula guard and keeps other apostrophes', () => {
    expect(unguardCell("'=SUM(A1)")).toBe('=SUM(A1)');
    expect(unguardCell("'-5 off")).toBe('-5 off');
    expect(unguardCell("'quoted'")).toBe("'quoted'");
    expect(unguardCell("O'Reilly")).toBe("O'Reilly");
  });
});
