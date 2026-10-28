import {describe, expect, it} from 'vitest';
import {formatWarningSummary} from '../../src/generate/summary.js';
import type {Project} from '../../src/project/schema.js';

const scene = (id: string, warnings: string[]) =>
  ({id, narration: 'n', spec: {type: 'title', title: 't', decor: 'none', characters: 0}, status: 'ok', durationFrames: 100, factIds: [], warnings});
const project = (scenes: ReturnType<typeof scene>[]) => ({scenes}) as unknown as Project;

describe('formatWarningSummary', () => {
  it('is empty when no scene has warnings', () => {
    expect(formatWarningSummary(project([scene('s01', []), scene('s02', [])]))).toBe('');
  });

  it('lists each scene with its warnings, in scene order', () => {
    const out = formatWarningSummary(
      project([
        scene('s01', []),
        scene('s02', ['Scene could not be generated; simple title used']),
        scene('s03', ['Unverified figure: Alpha vaut 1', 'Layout may overflow the frame']),
      ]),
    );
    expect(out).toBe(
      [
        'Warnings in 2 of 3 scenes:',
        '  s02: Scene could not be generated; simple title used',
        '  s03: Unverified figure: Alpha vaut 1',
        '  s03: Layout may overflow the frame',
      ].join('\n'),
    );
  });

  it('adds the YouTube kit warnings, with or without scene warnings', () => {
    const p = {...project([scene('s01', [])]), youtube: {warnings: ['Too few chapters']}} as unknown as Project;
    expect(formatWarningSummary(p)).toBe(['YouTube kit:', '  Too few chapters'].join('\n'));
    const q = {...project([scene('s01', ['x'])]), youtube: {warnings: ['y']}} as unknown as Project;
    expect(formatWarningSummary(q)).toBe(['Warnings in 1 of 1 scenes:', '  s01: x', 'YouTube kit:', '  y'].join('\n'));
  });
});
