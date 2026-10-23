import {describe, expect, it} from 'vitest';
import {getTheme} from '../src/theme';

const styles = ['papier', 'craie', 'infographie', 'nuit'] as const;

describe('getTheme', () => {
  it('uses the skill colours and filters', () => {
    expect(getTheme('craie').colors.ciel).toBe('#2f4a3c');
    expect(getTheme('nuit').colors.texteFond).toBe('#eef1ff');
    expect(getTheme('infographie').filter).toBe('plat');
  });

  it('falls back to papier', () => {
    expect(getTheme('nope').name).toBe('papier');
    expect(getTheme(undefined).name).toBe('papier');
  });

  it('gives every style the same palette keys', () => {
    const keys = Object.keys(getTheme('papier').colors).sort();
    for (const s of styles) expect(Object.keys(getTheme(s).colors).sort()).toEqual(keys);
  });
});
