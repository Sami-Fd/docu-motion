import {describe, expect, it} from 'vitest';
import {labelRows, twoLines, wrapText} from '../src/types/textLayout';

describe('twoLines', () => {
  it('never returns more than two lines', () => {
    // Greedy wrapping at ceil(len/2) gives three lines here ("ab" / "cdefghij" / "klmnop").
    expect(wrapText('ab cdefghij klmnop', 9)).toHaveLength(3);
    expect(twoLines('ab cdefghij klmnop')).toEqual(['ab cdefghij', 'klmnop']);
    expect(twoLines('un deux trois quatre cinq six sept')).toHaveLength(2);
  });
  it('breaks where the longer line is shortest', () => {
    // "Création" / "de la Sécu" (longest 10) beats "Création de" / "la Sécu" (longest 11).
    expect(twoLines('Création de la Sécu')).toEqual(['Création', 'de la Sécu']);
  });
  it('keeps a single word on one line and handles empty text', () => {
    expect(twoLines('Accidents')).toEqual(['Accidents']);
    expect(twoLines('  ')).toEqual([]);
  });
  it('keeps every word, in order', () => {
    const text = 'Séparation des branches de la Sécu';
    expect(twoLines(text).join(' ')).toBe(text);
  });
});

describe('labelRows', () => {
  // charWidth 0.5 at size 36 -> 18 px per character; maxWidth 360 -> 20 characters at full size.
  const row = (labels: string[]) => labelRows(labels, 360, 36, 0.5);
  it('keeps a label that fits at full size on one line', () => {
    expect(row(['Création de la Sécu'])).toEqual({lines: [['Création de la Sécu']], size: 36});
  });
  it('wraps to two full-size lines rather than shrinking one line', () => {
    // 22 characters: one line would need 32.7 px; two lines fit at 36.
    expect(row(['Séparation des branche'])).toEqual({lines: [['Séparation', 'des branche']], size: 36});
  });
  it('shrinks the two-line layout only when it does not fit at full size', () => {
    const r = row(['Réformedelassurancemaladie universelleobligat']);
    expect(r.lines[0]).toHaveLength(2);
    expect(r.size).toBeLessThan(36);
    expect(r.size).toBeCloseTo(360 / (26 * 0.5));
  });
  it('one long label shrinks the shared size, short labels stay on one line', () => {
    const r = row(['Maladie', 'Réformedelassurancemaladie universelleobligat']);
    expect(r.lines[0]).toEqual(['Maladie']);
    expect(r.size).toBeLessThan(36);
  });
});
