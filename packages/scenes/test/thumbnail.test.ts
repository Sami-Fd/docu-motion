import {describe, expect, it} from 'vitest';
import {THUMBNAIL_EXAMPLES, ThumbnailSpecSchema, type ThumbnailSpec} from '../src/thumbnail/schema';
import {MIN_WORD_SIZE, OUTLINE_EM, fitWordSize, upperCase} from '../src/thumbnail/fit';

const base: ThumbnailSpec = {words: ['LA', 'SECU', 'COUTE'], characters: 1, element: 'none', highlight: 1};
const fails = (s: unknown) => !ThumbnailSpecSchema.safeParse(s).success;

describe('ThumbnailSpecSchema', () => {
  it('accepts the 3 examples', () => {
    expect(THUMBNAIL_EXAMPLES).toHaveLength(3);
    for (const e of THUMBNAIL_EXAMPLES) {
      const r = ThumbnailSpecSchema.safeParse(e);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    }
  });
  it('rejects a word of 15 characters and accepts 14', () => {
    expect(fails({...base, words: ['A'.repeat(15), 'B']})).toBe(true);
    expect(fails({...base, words: ['A'.repeat(14), 'B']})).toBe(false);
  });
  it('counts code points, not UTF-16 units', () => {
    expect([...'Sécu 🏥'].length).toBe(6);
    expect(fails({...base, words: ['Sécu 🏥', 'ok'], highlight: 0})).toBe(false);
    expect(fails({...base, words: ['🏥'.repeat(14), 'ok'], highlight: 0})).toBe(false);
    expect(fails({...base, words: ['🏥'.repeat(15), 'ok'], highlight: 0})).toBe(true);
    expect(fails({...base, figure: '🏥'.repeat(12)})).toBe(false);
    expect(fails({...base, figure: '🏥'.repeat(13)})).toBe(true);
  });
  it('rejects an empty word, too few or too many words', () => {
    expect(fails({...base, words: ['', 'a']})).toBe(true);
    expect(fails({...base, words: ['a'], highlight: 0})).toBe(true);
    expect(fails({...base, words: ['a', 'b', 'c', 'd', 'e'], highlight: 0})).toBe(true);
  });
  it('rejects a highlight outside the words, with the issue on highlight', () => {
    const r = ThumbnailSpecSchema.safeParse({...base, highlight: 3});
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('highlight');
    expect(fails({...base, highlight: 2})).toBe(false);
  });
  it('counts a decomposed accent as one character', () => {
    const nfd = 'é'.repeat(14); // 14 accented letters, 28 UTF-16 units
    expect(nfd.length).toBe(28);
    expect(fails({...base, words: [nfd, 'ok'], highlight: 0})).toBe(false);
    expect(fails({...base, words: [nfd + 'é', 'ok'], highlight: 0})).toBe(true);
  });
  it('rejects bad characters count and element', () => {
    expect(fails({...base, characters: 0})).toBe(true);
    expect(fails({...base, characters: 3})).toBe(true);
    expect(fails({...base, element: 'star'})).toBe(true);
  });
});

describe('fitWordSize', () => {
  it('uses an injected measure instead of the estimate', () => {
    const narrow = fitWordSize(['mmmm', 'ok'], {maxWidth: 1000, textScale: 1, measure: () => 1});
    const wide = fitWordSize(['mmmm', 'ok'], {maxWidth: 1000, textScale: 1, measure: (t) => (t === 'mmmm' ? 8 : 1)});
    expect(wide).toBeLessThan(narrow);
    // The widest measured word (plus its outline) fills the zone.
    expect(wide * (8 + OUTLINE_EM)).toBeLessThanOrEqual(1000.001);
  });
  it('is larger for short words and never below the minimum', () => {
    const short = fitWordSize(['LA', 'SECU'], {maxWidth: 1000, textScale: 1});
    const long = fitWordSize(['W'.repeat(14), 'W'.repeat(14)], {maxWidth: 1000, textScale: 1});
    expect(short).toBeGreaterThan(long);
    expect(long).toBeGreaterThanOrEqual(MIN_WORD_SIZE);
    expect(fitWordSize(['W'.repeat(14)], {maxWidth: 100, textScale: 1})).toBe(MIN_WORD_SIZE);
  });
  it('shrinks with more lines and with textScale', () => {
    const two = fitWordSize(['A', 'B'], {maxWidth: 1000, textScale: 1});
    const four = fitWordSize(['A', 'B', 'C', 'D'], {maxWidth: 1000, textScale: 1});
    expect(four).toBeLessThan(two);
    expect(fitWordSize(['A', 'B'], {maxWidth: 1000, textScale: 1.15})).toBeLessThanOrEqual(two);
  });
});

describe('upperCase', () => {
  it('upper-cases, following the language when it is valid', () => {
    expect(upperCase('sécu')).toBe('SÉCU');
    expect(upperCase('iz', 'tr')).toBe('İZ');
    expect(upperCase('iz', 'en')).toBe('IZ');
    expect(upperCase('straße')).toBe('STRASSE');
  });
  it('falls back to the default rules on a malformed language tag instead of throwing', () => {
    for (const bad of ['en_US', '', 'français']) {
      expect(() => 'x'.toLocaleUpperCase(bad)).toThrow(RangeError);
      expect(upperCase('sécu', bad)).toBe('SÉCU');
    }
  });
});
