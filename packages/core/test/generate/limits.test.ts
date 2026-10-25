import {describe, expect, it} from 'vitest';
import {EXAMPLES, SceneSpecSchema, type SceneType} from '@docu-motion/scenes';
import {LIMITS} from '../../src/generate/prompts.js';

type Row = {type: SceneType; path: (string | number)[]; max: number; kind: 'str' | 'arr' | 'num'};
const rows: Row[] = [
  {type: 'title', path: ['title'], max: 48, kind: 'str'},
  {type: 'title', path: ['subtitle'], max: 70, kind: 'str'},
  {type: 'title', path: ['characters'], max: 6, kind: 'num'},
  {type: 'bars', path: ['title'], max: 48, kind: 'str'},
  {type: 'bars', path: ['bars'], max: 8, kind: 'arr'},
  {type: 'bars', path: ['bars', 0, 'label'], max: 18, kind: 'str'},
  {type: 'bars', path: ['unit'], max: 8, kind: 'str'},
  {type: 'donut', path: ['title'], max: 48, kind: 'str'},
  {type: 'donut', path: ['parts'], max: 6, kind: 'arr'},
  {type: 'donut', path: ['parts', 0, 'label'], max: 26, kind: 'str'},
  {type: 'counter', path: ['title'], max: 48, kind: 'str'},
  {type: 'counter', path: ['prefix'], max: 4, kind: 'str'},
  {type: 'counter', path: ['suffix'], max: 10, kind: 'str'},
  {type: 'counter', path: ['label'], max: 60, kind: 'str'},
  {type: 'pictograms', path: ['title'], max: 48, kind: 'str'},
  {type: 'pictograms', path: ['groups'], max: 2, kind: 'arr'},
  {type: 'pictograms', path: ['groups', 0, 'label'], max: 24, kind: 'str'},
  {type: 'pictograms', path: ['groups', 0, 'count'], max: 12, kind: 'num'},
  {type: 'pictograms', path: ['groups', 0, 'ratio'], max: 8, kind: 'str'},
  {type: 'comparison', path: ['title'], max: 48, kind: 'str'},
  {type: 'comparison', path: ['left', 'heading'], max: 24, kind: 'str'},
  {type: 'comparison', path: ['left', 'value'], max: 12, kind: 'str'},
  {type: 'comparison', path: ['left', 'caption'], max: 40, kind: 'str'},
  {type: 'comparison', path: ['right', 'heading'], max: 24, kind: 'str'},
  {type: 'comparison', path: ['right', 'value'], max: 12, kind: 'str'},
  {type: 'comparison', path: ['right', 'caption'], max: 40, kind: 'str'},
  {type: 'quote', path: ['title'], max: 48, kind: 'str'},
  {type: 'quote', path: ['text'], max: 180, kind: 'str'},
  {type: 'quote', path: ['author'], max: 40, kind: 'str'},
  {type: 'timeline', path: ['title'], max: 48, kind: 'str'},
  {type: 'timeline', path: ['events'], max: 6, kind: 'arr'},
  {type: 'timeline', path: ['events', 0, 'date'], max: 10, kind: 'str'},
  {type: 'timeline', path: ['events', 0, 'label'], max: 28, kind: 'str'},
  {type: 'list', path: ['title'], max: 48, kind: 'str'},
  {type: 'list', path: ['items'], max: 5, kind: 'arr'},
  {type: 'list', path: ['items', 0, 'text'], max: 60, kind: 'str'},
];

function build(row: Row, n: number): unknown {
  const spec = structuredClone(EXAMPLES[row.type]) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parent = row.path.slice(0, -1).reduce<any>((o, k) => o[k], spec);
  const key = row.path[row.path.length - 1]!;
  if (row.kind === 'str') parent[key] = 'x'.repeat(n);
  else if (row.kind === 'num') parent[key] = n;
  else {
    const first = parent[key][0];
    parent[key] = Array.from({length: n}, () => structuredClone(first));
    if (row.type === 'donut') for (const part of parent[key]) part.value = 100 / n;
  }
  return spec;
}

describe('scene prompt limits match the schemas', () => {
  it.each(rows)('$type $path accepts $max and rejects $max+1', (row) => {
    expect(SceneSpecSchema.safeParse(build(row, row.max)).success).toBe(true);
    expect(SceneSpecSchema.safeParse(build(row, row.max + 1)).success).toBe(false);
  });

  it.each(rows)('$type $path max appears in the prompt text', (row) => {
    expect(LIMITS[row.type]).toMatch(new RegExp(`(^|\\D)${row.max}(\\D|$)`));
  });
});
