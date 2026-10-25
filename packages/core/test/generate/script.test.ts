import {describe, expect, it} from 'vitest';
import {estimateDurationFrames, SceneSpecSchema} from '@docu-motion/scenes';
import type {StepContext} from '../../src/generate/context.js';
import {sceneCount, scriptStep} from '../../src/generate/steps/script.js';
import {createFakeProvider} from '../../src/llm/fake.js';
import type {Project} from '../../src/project/schema.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const words = (n: number) => Array.from({length: n}, (_, i) => `mot${i}`).join(' ');
const project = (targetMinutes = 3, topic = 'La CSG'): Project =>
  ({
    version: 1,
    brief: {topic, language: 'fr', targetMinutes, style: 'papier', provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off', sources: []},
    sources: [],
    facts: [
      {id: 'f1', statement: 'La CSG finance la sécu', value: '9,2 %', verified: true},
      {id: 'f2', statement: 'Créée en 1990', verified: false},
    ],
    scenes: [],
    voice: {engine: 'none'},
    progress: {done: []},
  }) as unknown as Project;

function setup(respond: (prompt: string, call: number) => unknown) {
  const prompts: string[] = [];
  const ctx: StepContext = {
    projectDir: '.',
    llm: createFakeProvider(({prompt}) => {
      prompts.push(prompt);
      return respond(prompt, prompts.length);
    }),
    settings: SettingsSchema.parse({}),
    fetch: (async () => new Response('')) as unknown as typeof fetch,
    onProgress: () => {},
  };
  return {ctx, prompts};
}
const valid = (n: number, factIds: string[] = ['f1']) => ({scenes: Array.from({length: n}, () => ({narration: words(30), factIds}))});

describe('sceneCount', () => {
  it('clamps to 8..12', () => {
    expect(sceneCount(1)).toBe(8);
    expect(sceneCount(3)).toBe(11);
    expect(sceneCount(10)).toBe(12);
  });
});

describe('scriptStep', () => {
  it('retries a short narration with the issue path in the prompt', async () => {
    const {ctx, prompts} = setup((_p, call) => {
      if (call === 1) {
        const o = valid(11);
        o.scenes[0]!.narration = words(12);
        return o;
      }
      return valid(11);
    });
    const out = await scriptStep(project(3), ctx);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('scenes.0.narration');
    expect(prompts[1]).toContain('12');
    expect(out.scenes).toHaveLength(11);
  });

  it('drops unknown fact ids and states the rules in the prompt', async () => {
    const {ctx, prompts} = setup(() => valid(11, ['f1', 'f99']));
    const out = await scriptStep(project(3), ctx);
    expect(out.scenes.every((s) => s.factIds.join() === 'f1')).toBe(true);
    expect(prompts[0]).toContain('f1: La CSG finance la sécu (9,2 %)');
    expect(prompts[0]).toContain('f2: Créée en 1990');
    expect(prompts[0]).toContain('11');
  });

  it('deduplicates fact ids', async () => {
    const {ctx} = setup(() => valid(11, ['f1', 'f1', 'f2', 'f1']));
    const out = await scriptStep(project(3), ctx);
    expect(out.scenes[0]!.factIds).toEqual(['f1', 'f2']);
  });

  it('builds ids, placeholder specs and durations', async () => {
    const {ctx} = setup(() => valid(11));
    const out = await scriptStep(project(3), ctx);
    expect(out.scenes.map((s) => s.id)).toEqual(Array.from({length: 11}, (_, i) => `s${String(i + 1).padStart(2, '0')}`));
    const s = out.scenes[0]!;
    expect(s.spec).toEqual({type: 'title', title: 'La CSG', decor: 'none', characters: 0});
    expect(s.durationFrames).toBe(estimateDurationFrames(s.narration));
    expect(s.status).toBe('ok');
    expect(s.warnings).toEqual([]);
  });

  it('cuts a long topic on a word boundary within 48 chars, valid title', async () => {
    const topic = 'Pourquoi le financement de la protection sociale en France repose sur la CSG';
    const {ctx} = setup(() => valid(11));
    const out = await scriptStep(project(3, topic), ctx);
    const title = (out.scenes[0]!.spec as {title: string}).title;
    expect(title.length).toBeLessThanOrEqual(48);
    expect(topic.startsWith(title)).toBe(true);
    expect(topic.charAt(title.length)).toBe(' ');
    expect(SceneSpecSchema.safeParse(out.scenes[0]!.spec).success).toBe(true);
    const long = await scriptStep(project(3, 'x'.repeat(100)), ctx);
    expect((long.scenes[0]!.spec as {title: string}).title).toBe('x'.repeat(48));
  });

  it('replaces scenes on rerun and passes the signal', async () => {
    const {ctx} = setup(() => valid(8));
    const seen: (AbortSignal | undefined)[] = [];
    const llm = {...ctx.llm, generateObject: ((a: {signal?: AbortSignal}) => (seen.push(a.signal), ctx.llm.generateObject(a as never))) as typeof ctx.llm.generateObject};
    const signal = new AbortController().signal;
    const first = await scriptStep(project(1), {...ctx, llm, signal});
    const again = await scriptStep(first, {...ctx, llm, signal});
    expect(again.scenes).toHaveLength(8);
    expect(seen[0]).toBe(signal);
  });
});
