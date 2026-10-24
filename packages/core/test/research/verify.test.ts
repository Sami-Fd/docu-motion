import {describe, expect, it} from 'vitest';
import {excerptFound} from '../../src/research/verify.js';

describe('excerptFound', () => {
  const src = 'Selon le rapport, la CSG finance 20 % des recettes';
  it('ignores whitespace and case', () => {
    expect(excerptFound('la  CSG finance 20 %', src)).toBe(true);
    expect(excerptFound('LA CSG\nFINANCE 20 %', src)).toBe(true);
  });
  it('treats no-break spaces as whitespace', () => {
    expect(excerptFound('la CSG finance 20 % des recettes', 'Selon le rapport, la CSG finance 20\u202f% des recettes')).toBe(true);
    expect(excerptFound('la CSG finance 20 % des recettes', 'la CSG finance 20\u00a0% des recettes')).toBe(true);
  });
  it('ignores quote style and dashes', () => {
    expect(excerptFound("l'État finance tout ça", 'Ici l\u2019État finance tout ça.')).toBe(true);
    expect(excerptFound('il dit "bonjour à tous"', 'il dit \u00ab bonjour à tous \u00bb') ).toBe(true);
    expect(excerptFound('de 2010 - 2020 inclus', 'de 2010 \u2013 2020 inclus')).toBe(true);
  });
  it('rejects invented text', () => {
    expect(excerptFound('la CSG finance 90 % des dépenses', src)).toBe(false);
  });
  it('never verifies short excerpts', () => {
    expect(excerptFound('CSG', src)).toBe(false);
    expect(excerptFound('rapport', src)).toBe(false);
  });
});
