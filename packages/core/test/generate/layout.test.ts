import {describe, expect, it} from 'vitest';
import type {StepContext} from '../../src/generate/context.js';
import {layoutStep} from '../../src/generate/steps/layout.js';
import {createFakeProvider} from '../../src/llm/fake.js';
import type {Project} from '../../src/project/schema.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const bars = {type: 'bars', title: 'Dépenses', bars: [{label: 'A', value: 1}, {label: 'B', value: 2}]};
const WARN = 'Layout may overflow the frame';

const scene = (id: string, warnings: string[] = []) => ({
  id, narration: 'Alpha pèse un. Beta pèse deux.', spec: bars, status: 'ok', durationFrames: 100, factIds: ['f1'], warnings,
});
const project = (warnings: string[] = []): Project =>
  ({
    version: 1,
    brief: {topic: 'T', language: 'fr', targetMinutes: 3, style: 'papier', provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off', sources: []},
    sources: [{id: 'src1', kind: 'url', title: 'INSEE', uri: 'https://x', textPath: 'a'}],
    facts: [{id: 'f1', statement: 'Alpha vaut 1', value: '1', sourceId: 'src1', verified: true}],
    scenes: [scene('s01'), scene('s02', warnings)],
    voice: {engine: 'none'},
    progress: {done: []},
  }) as unknown as Project;

function setup() {
  const prompts: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const base = createFakeProvider(({prompt}) => (prompts.push(prompt), {...bars, title: 'Court'}));
  const llm = {...base, generateObject: ((a: {signal?: AbortSignal}) => (signals.push(a.signal), base.generateObject(a as never))) as typeof base.generateObject};
  const signal = new AbortController().signal;
  const ratios: (number | undefined)[] = [];
  const ctx: StepContext = {
    projectDir: '.', llm, settings: SettingsSchema.parse({}), signal,
    fetch: (async () => new Response('')) as unknown as typeof fetch,
    onProgress: (e) => ratios.push(e.ratio),
  };
  return {ctx, prompts, signals, signal, ratios};
}

describe('layoutStep', () => {
  it('regenerates once when the retry fixes the overflow: no warning', async () => {
    const {ctx, prompts, signals, signal, ratios} = setup();
    const seq = [500, 0, 0];
    const checkScene = async (_d: string, _p: Project, i: number) => ({outside: i === 0 ? seq.shift()! : 0});
    const out = await layoutStep({checkScene})(project(), ctx);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('The previous layout overflowed the frame; use shorter labels and fewer items.');
    expect(signals[0]).toBe(signal);
    expect((out.scenes[0]!.spec as {title: string}).title).toBe('Court');
    expect((out.scenes[0]!.spec as {source?: string}).source).toBe('INSEE');
    expect(out.scenes[0]!.warnings).toEqual([]);
    expect(out.scenes[1]!.spec).toEqual(bars);
    expect(ratios).toEqual([0.5, 1]);
  });

  it('warns after one failed regeneration', async () => {
    const {ctx, prompts} = setup();
    const out = await layoutStep({checkScene: async () => ({outside: 500})})(project(), ctx);
    expect(prompts).toHaveLength(2); // one per scene, never more
    expect(out.scenes[0]!.warnings).toEqual([WARN]);
  });

  it('does not regenerate at the tolerance of 20 pixels', async () => {
    const {ctx, prompts} = setup();
    const out = await layoutStep({checkScene: async () => ({outside: 20})})(project(), ctx);
    expect(prompts).toHaveLength(0);
    expect(out.scenes[0]!.warnings).toEqual([]);
  });

  it('replaces its own earlier warning without duplicating, keeps other warnings', async () => {
    const {ctx} = setup();
    const p = project(['custom', WARN]);
    const again = await layoutStep({checkScene: async () => ({outside: 500})})(p, ctx);
    expect(again.scenes[1]!.warnings).toEqual(['custom', WARN]);
    const fixed = await layoutStep({checkScene: async () => ({outside: 0})})(p, ctx);
    expect(fixed.scenes[1]!.warnings).toEqual(['custom']);
  });

  it('a fallback scene regenerated cleanly loses its fallback warning; other warnings survive', async () => {
    const {ctx} = setup();
    const FALLBACK = 'Scene could not be generated; simple title used';
    const p = project(['custom', FALLBACK]);
    p.scenes[1] = {...p.scenes[1]!, status: 'fallback'};
    const seq = [500, 0];
    const checkScene = async (_d: string, _p: Project, i: number) => ({outside: i === 1 ? seq.shift()! : 0});
    const out = await layoutStep({checkScene})(p, ctx);
    expect(out.scenes[1]!.status).toBe('ok');
    expect(out.scenes[1]!.warnings).toEqual(['custom']);
  });

  it('keeps the original spec with a warning when the regeneration yields unusable output', async () => {
    const {ctx} = setup();
    const llm = createFakeProvider(() => ({type: 'nope'}));
    let checks = 0;
    const checkScene = async (_d: string, _p: Project, i: number) => (i === 0 && checks++, {outside: i === 0 ? 500 : 0});
    const out = await layoutStep({checkScene})(project(), {...ctx, llm});
    expect(out.scenes[0]!.spec).toEqual(bars);
    expect(out.scenes[0]!.status).toBe('ok');
    expect(out.scenes[0]!.warnings).toEqual([WARN]);
    expect(checks).toBe(1);
  });

  it('stops on cancellation', async () => {
    const {ctx} = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(layoutStep({checkScene: async () => ({outside: 0})})(project(), {...ctx, signal: ac.signal})).rejects.toThrow();
  });
});
