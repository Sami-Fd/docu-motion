import { describe, expect, it } from 'vitest';
import { cueFrame, durationFromAudio, estimateDurationFrames, normalise } from '../src/timing';

describe('cueFrame', () => {
  it('uses the skill formula when the cue is found', () => {
    const narration = 'a'.repeat(79) + ' tva' + ' '.repeat(0) + 'b'.repeat(17);
    const n = normalise(narration);
    expect(n.length).toBe(100);
    expect(n.indexOf('tva')).toBe(80);
    expect(cueFrame(narration, 'TVA', 300, 0)).toBe(Math.round((80 / 100) * 285 * 0.85));
    expect(cueFrame(narration, 'TVA', 300, 0)).toBe(194);
  });

  it('matches regardless of case, accents and punctuation', () => {
    const exact = cueFrame("La sécu, c'est bien", 'sécu', 300, 0);
    expect(cueFrame("La sécu, c'est bien", 'Sécu', 300, 0)).toBe(exact);
    expect(cueFrame("La sécu, c'est bien", 'SECU.', 300, 0)).toBe(exact);
    expect(cueFrame('La Sécu, c’est bien', 'secu', 300, 0)).toBe(exact);
    expect(exact).toBeGreaterThan(15 + 0);
  });

  it('falls back when the cue is missing', () => {
    expect([0, 1, 2].map((i) => cueFrame('hello world', 'zzz', 300, i))).toEqual([15, 27, 39]);
  });

  it('clamps the fallback to durationFrames - 20', () => {
    expect(cueFrame('hello world', 'zzz', 40, 5)).toBe(20);
  });

  it('falls back when cue is undefined or empty', () => {
    expect(cueFrame('hello', undefined, 300, 1)).toBe(27);
    expect(cueFrame('hello', '  ', 300, 1)).toBe(27);
  });

  it('never returns a negative frame', () => {
    expect(cueFrame('', 'x', 300, 0)).toBeGreaterThanOrEqual(0);
    expect(cueFrame('', undefined, 10, 3)).toBe(0);
    expect(cueFrame('abc def', 'def', 10, 0)).toBeGreaterThanOrEqual(0);
    expect(cueFrame('abc def', 'zzz', 20, 0)).toBe(0);
    expect(cueFrame('abc def', 'def', 0, 0)).toBe(0);
  });
});

describe('durations', () => {
  it('estimates from word count', () => {
    const text = Array.from({ length: 24 }, (_, i) => `w${i}`).join(' ');
    expect(estimateDurationFrames(text)).toBe(345);
    expect(estimateDurationFrames(`  ${text}  `)).toBe(345);
  });
  it('derives from audio seconds', () => {
    expect(durationFromAudio(10)).toBe(336);
  });
});
