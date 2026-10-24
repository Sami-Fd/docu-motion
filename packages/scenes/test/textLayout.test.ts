import {describe, expect, it} from 'vitest';
import {twoLines, wrapText} from '../src/types/textLayout';

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
