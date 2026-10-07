import { describe, expect, it } from 'vitest';
import { generateCatalog, parseCsv } from './generate-vehicle-catalog.mjs';

describe('catalog generation', () => {
  it('discards years, prefers baseModel, falls back to model, preserves punctuation and quotes, deduplicates and sorts deterministically', () => {
    const header = 'year,make,model,baseModel\n';
    const rows = [
      '1990, Toyota ,RAV4 AWD,RAV4',
      '2026,TOYOTA,RAV4 4WD,rav4',
      '1984,Honda,CR-V,',
      '2000,"O\'Brien, Inc.","Model ""S""",',
    ];
    const result = generateCatalog(header + rows.join('\n'));
    expect(result.errors).toEqual([]);
    expect(result.makeCount).toBe(3);
    expect(result.modelCount).toBe(3);
    expect(result.conflicts).toHaveLength(2);
    expect(result.sql).toContain("O''Brien, Inc.");
    expect(result.sql).toContain('CR-V');
    expect(result.sql).toContain('Model "S"');
    expect(result.sql).not.toContain('1990');
    expect(result.sql).not.toContain('RAV4 AWD');
    expect(generateCatalog(header + rows.reverse().join('\n'))).toEqual(result);
  });
  it('reports malformed rows, empty and overlength names without producing a partial seed', () => {
    const result = generateCatalog(
      `make,model\nToyota\n,Unknown\nToyota,${'X'.repeat(51)}\nToyota,RAV4\n`,
    );
    expect(result.errors).toHaveLength(3);
    expect(result.sql).toBeNull();
    expect(result.errors.join(' ')).toContain('Record 2');
    expect(generateCatalog('make,model\n"Toyota,RAV4').errors).toEqual([
      'Unterminated quoted field',
    ]);
    expect(generateCatalog('year,make\n2020,Toyota').errors).toHaveLength(1);
    expect(generateCatalog('make,make,model\nA,A,B').errors).toHaveLength(1);
  });
  it('handles CRLF, BOM, quoted newlines, escaped quotes and rejects stray quotes', () => {
    expect(parseCsv('\uFEFFmake,model\r\nA,"B\nC"\r\n')).toEqual([
      ['make', 'model'],
      ['A', 'B\nC'],
    ]);
    expect(() => parseCsv('A,B"C')).toThrow('Unexpected quote');
    expect(() => parseCsv('A,"B"X')).toThrow('Unexpected text');
    expect(generateCatalog('make,model,basemodel\nA,B,C').sql).toContain("'C'");
  });
});
