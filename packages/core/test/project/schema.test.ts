import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {EXAMPLES, SCENE_TYPES} from '@docu-motion/scenes';
import {ProjectSchema} from '../../src/project/schema.js';

const project = (scenes: {id: string; durationFrames?: number}[]) => ({
  version: 1,
  brief: {
    topic: 't', language: 'fr', targetMinutes: 2, style: 'papier',
    provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off',
  },
  sources: [],
  facts: [],
  scenes: scenes.map(({id, durationFrames = 90}) => ({
    id, narration: 'texte', spec: EXAMPLES.title, status: 'ok', durationFrames,
  })),
  voice: {engine: 'none'},
});

const issues = (input: unknown) => {
  const r = ProjectSchema.safeParse(input);
  return (r.error?.issues ?? []).map((i) => ({path: i.path.join('.'), message: i.message}));
};

describe('ProjectSchema', () => {
  it('accepts scenes using every example', () => {
    const p = {
      ...project([]),
      scenes: SCENE_TYPES.map((t, i) => ({
        id: `s${i}`, narration: 'texte', spec: EXAMPLES[t], status: 'ok', durationFrames: 90,
      })),
    };
    const r = ProjectSchema.safeParse(p);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts the demo project', () => {
    const file = fileURLToPath(new URL('../../../../examples/how-it-works/project.json', import.meta.url));
    const r = ProjectSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it.each(['s0', '01-titre', 'A_b-9', 'x'.repeat(64)])('accepts scene id %j', (id) => {
    expect(issues(project([{id}]))).toEqual([]);
  });

  it.each(['', '-a', '_a', 'a b', 'a/b', '..', 'a.png', 'é', 'x'.repeat(65)])('rejects scene id %j', (id) => {
    expect(issues(project([{id}])).map((i) => i.path)).toEqual(['scenes.0.id']);
  });

  it('rejects a duplicate scene id on the duplicate', () => {
    const found = issues(project([{id: 'a'}, {id: 'b'}, {id: 'a'}]));
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe('scenes.2.id');
    expect(found[0]!.message).toBe('Duplicate scene id "a" (already used by scene 0)');
  });

  it.each([0, -30, 12.5])('rejects durationFrames %d', (durationFrames) => {
    expect(issues(project([{id: 'a', durationFrames}])).map((i) => i.path)).toEqual(['scenes.0.durationFrames']);
  });
});
