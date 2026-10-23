import {describe, expect, it} from 'vitest';
import {EXAMPLES, SCENE_TYPES, SceneSpecSchema} from '../src/schema';
import {ProjectSchema} from '../../core/src/project/schema';

const pathsOf = (r: {success: boolean; error?: {issues: {path: (string | number)[]}[]}}) =>
  (r.error?.issues ?? []).map((i) => i.path.join('.'));

describe('scene schemas', () => {
  it('has 9 types and every example parses', () => {
    expect(SCENE_TYPES.length).toBe(9);
    for (const t of SCENE_TYPES) {
      const r = SceneSpecSchema.safeParse(EXAMPLES[t]);
      expect(r.success, `${t}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      expect(EXAMPLES[t].type).toBe(t);
    }
  });

  it('rejects a donut not summing to 100 with an issue on parts', () => {
    const bad = {...EXAMPLES.donut, parts: [
      {label: 'A', value: 50},
      {label: 'B', value: 40},
    ]};
    const r = SceneSpecSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(pathsOf(r)).toContain('parts');
    expect(r.error?.issues[0]?.message).toContain('90');
  });

  it('accepts a donut within tolerance', () => {
    const ok = {...EXAMPLES.donut, parts: [
      {label: 'A', value: 50.3},
      {label: 'B', value: 50},
    ]};
    expect(SceneSpecSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects a 19-character bar label at bars.0.label', () => {
    const bars = EXAMPLES.bars.bars;
    const bad = {...EXAMPLES.bars, bars: [{label: 'x'.repeat(19), value: 1}, bars[1]!]};
    const r = SceneSpecSchema.safeParse(bad);
    expect(pathsOf(r)).toContain('bars.0.label');
    expect(r.error?.issues[0]?.message).toMatch(/at most 18/);
  });

  it('rejects 1 bar and 9 bars', () => {
    const mk = (n: number) => ({...EXAMPLES.bars, bars: Array.from({length: n}, () => ({label: 'a', value: 1}))});
    expect(SceneSpecSchema.safeParse(mk(1)).success).toBe(false);
    expect(SceneSpecSchema.safeParse(mk(2)).success).toBe(true);
    expect(SceneSpecSchema.safeParse(mk(8)).success).toBe(true);
    expect(SceneSpecSchema.safeParse(mk(9)).success).toBe(false);
  });

  it('rejects a 49-character title and a 200-character title', () => {
    expect(SceneSpecSchema.safeParse({...EXAMPLES.title, title: 'x'.repeat(48)}).success).toBe(true);
    expect(SceneSpecSchema.safeParse({...EXAMPLES.title, title: 'x'.repeat(49)}).success).toBe(false);
    expect(SceneSpecSchema.safeParse({...EXAMPLES.quote, title: 'x'.repeat(200)}).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(SceneSpecSchema.safeParse({type: 'map', title: 'x'}).success).toBe(false);
  });

  it('ProjectSchema accepts scenes using every example', () => {
    const project = {
      version: 1,
      brief: {
        topic: 't', language: 'fr', targetMinutes: 2, style: 'papier',
        provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off',
      },
      sources: [],
      facts: [],
      scenes: SCENE_TYPES.map((t, i) => ({
        id: `s${i}`, narration: 'texte', spec: EXAMPLES[t], status: 'ok', durationFrames: 90,
      })),
      voice: {engine: 'none'},
    };
    const r = ProjectSchema.safeParse(project);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});
