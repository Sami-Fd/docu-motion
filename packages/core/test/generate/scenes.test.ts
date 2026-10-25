import {describe, expect, it} from 'vitest';
import {EXAMPLES, SceneSpecSchema, type SceneSpec} from '@docu-motion/scenes';
import type {StepContext} from '../../src/generate/context.js';
import {applySceneResult, generateSceneSpec, scenesStep, withSourceLine} from '../../src/generate/steps/scenes.js';
import {createFakeProvider} from '../../src/llm/fake.js';
import {ProviderError} from '../../src/llm/types.js';
import type {Project} from '../../src/project/schema.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const bars = {
  type: 'bars',
  title: 'Dépenses',
  bars: [
    {label: 'A', value: 1, cue: 'alpha'},
    {label: 'B', value: 2},
  ],
};
const badDonut = {
  type: 'donut',
  title: 'Parts',
  parts: [
    {label: 'A', value: 40},
    {label: 'B', value: 50},
  ],
};

const project = (over: Partial<Project['scenes'][number]> = {}, narration = 'Alpha pèse un. Beta pèse deux.'): Project =>
  ({
    version: 1,
    brief: {topic: 'T', language: 'fr', targetMinutes: 3, style: 'papier', provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off', sources: []},
    sources: [{id: 'src1', kind: 'url', title: 'INSEE', uri: 'https://x', textPath: 'a'}],
    facts: [
      {id: 'f1', statement: 'Alpha vaut 1', value: '1', sourceId: 'src1', verified: true},
      {id: 'f2', statement: 'Beta vaut 2 environ', verified: false},
    ],
    scenes: [
      {id: 's01', narration, spec: {type: 'title', title: 'T', decor: 'none', characters: 0}, status: 'ok', durationFrames: 100, factIds: ['f1'], warnings: [], ...over},
    ],
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

describe('generateSceneSpec', () => {
  it('sets the source line from the cited fact', async () => {
    const {ctx} = setup(() => ({...bars, source: 'invented'}));
    const r = await generateSceneSpec(project(), 0, ctx);
    expect(r.status).toBe('ok');
    expect((r.spec as {source?: string}).source).toBe('INSEE');
  });

  it('falls back to a title after 4 invalid answers', async () => {
    const {ctx, prompts} = setup(() => badDonut);
    const r = await generateSceneSpec(project(), 0, ctx);
    expect(prompts).toHaveLength(4);
    expect(r.status).toBe('fallback');
    expect(r.warning).toBe('Scene could not be generated; simple title used');
    expect(r.spec).toEqual({type: 'title', title: 'Alpha pèse un', decor: 'none', characters: 0});
    expect(SceneSpecSchema.safeParse(r.spec).success).toBe(true);
  });

  it('cuts a long first sentence to 48 chars on a word boundary', async () => {
    const narration = 'Pourquoi le financement de la protection sociale en France repose sur la CSG ? Suite.';
    const {ctx} = setup(() => badDonut);
    const r = await generateSceneSpec(project({}, narration), 0, ctx);
    const title = (r.spec as {title: string}).title;
    expect(title.length).toBeLessThanOrEqual(48);
    expect(narration.startsWith(title)).toBe(true);
    expect(narration.charAt(title.length)).toBe(' ');
  });

  it('never yields an empty fallback title', async () => {
    const {ctx} = setup(() => badDonut);
    const r = await generateSceneSpec(project({}, '... ?'), 0, ctx);
    expect((r.spec as {title: string}).title.length).toBeGreaterThan(0);
    expect(SceneSpecSchema.safeParse(r.spec).success).toBe(true);
  });

  it('puts narration, facts, examples, cue rule, language and feedback in the prompt', async () => {
    const {ctx, prompts} = setup(() => bars);
    await generateSceneSpec(project(), 0, ctx, 'Make it punchier');
    const p = prompts[0]!;
    expect(p).toContain('Alpha pèse un. Beta pèse deux.');
    expect(p).toContain('f1: Alpha vaut 1 (1)');
    expect(p).toContain(JSON.stringify(EXAMPLES.donut));
    expect(p).toContain('cue');
    expect(p).toContain('fr');
    expect(p).toContain('Make it punchier');
    expect(p).not.toContain('f2:');
  });

  it('lets a provider error propagate', async () => {
    const {ctx} = setup(() => {
      throw new ProviderError('auth', {provider: 'x', transient: false, status: 401});
    });
    await expect(generateSceneSpec(project(), 0, ctx)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('withSourceLine', () => {
  const p = project();
  it('cuts the title to 80 chars on a word boundary', () => {
    const long = project();
    long.sources[0]!.title = Array.from({length: 30}, () => 'mot').join(' ');
    const out = withSourceLine(bars as SceneSpec, long, ['f1']) as {source: string};
    expect(out.source.length).toBeLessThanOrEqual(80);
    expect(out.source.endsWith('mot')).toBe(true);
    expect(SceneSpecSchema.safeParse(out).success).toBe(true);
  });
  it('removes an invented source when nothing resolves', () => {
    const out = withSourceLine({...bars, source: 'fake'} as SceneSpec, p, ['f2', 'nope']);
    expect('source' in out).toBe(false);
    expect(SceneSpecSchema.safeParse(out).success).toBe(true);
  });
  it('never cites the source of an unverified fact', () => {
    const q = project();
    q.facts.push({id: 'f3', statement: 'Gamma vaut 3', value: '3', sourceId: 'src1', verified: false});
    const out = withSourceLine({...bars, source: 'invented'} as SceneSpec, q, ['f3']);
    expect('source' in out).toBe(false);
    // a later verified fact is still used
    expect((withSourceLine(bars as SceneSpec, q, ['f3', 'f1']) as {source?: string}).source).toBe('INSEE');
  });
  it('drops an LLM-set source on quote scenes', () => {
    const q = EXAMPLES.quote;
    expect(withSourceLine(q, p, ['f1'])).toEqual(q);
    const out = withSourceLine({...q, source: 'Le Monde'} as SceneSpec, p, ['f1']);
    expect('source' in out).toBe(false);
    expect(SceneSpecSchema.safeParse(out).success).toBe(true);
  });
  it('leaves title untouched', () => {
    const t = {...EXAMPLES.title, source: 'x'};
    expect(withSourceLine(t, p, ['f1'])).toEqual(t);
  });
});

describe('scenesStep', () => {
  it('fills scenes, reports ratio, adds unverified warnings', async () => {
    const proj = project({factIds: ['f1', 'f2']});
    const ratios: (number | undefined)[] = [];
    const {ctx} = setup(() => bars);
    const out = await scenesStep(proj, {...ctx, onProgress: (e) => ratios.push(e.ratio)});
    expect(out.scenes[0]!.spec.type).toBe('bars');
    expect(out.scenes[0]!.status).toBe('ok');
    expect(out.scenes[0]!.warnings).toEqual(['Unverified figure: Beta vaut 2 environ']);
    expect(ratios).toContain(1);
  });

  it('records the fallback warning and status', async () => {
    const {ctx} = setup(() => badDonut);
    const out = await scenesStep(project(), ctx);
    expect(out.scenes[0]!.status).toBe('fallback');
    expect(out.scenes[0]!.warnings).toContain('Scene could not be generated; simple title used');
  });

  it('propagates cancellation instead of falling back', async () => {
    const {ctx} = setup(() => bars);
    const ac = new AbortController();
    ac.abort();
    await expect(scenesStep(project(), {...ctx, signal: ac.signal})).rejects.toThrow();
  });

  it('rethrows an AbortError mid-run without producing a fallback', async () => {
    const proj = project();
    proj.scenes.push({...proj.scenes[0]!, id: 's02'});
    const {ctx} = setup(() => bars);
    let calls = 0;
    const llm = {
      ...ctx.llm,
      generateObject: (async (a: never) => {
        if (++calls === 2) throw new DOMException('aborted', 'AbortError');
        return ctx.llm.generateObject(a);
      }) as typeof ctx.llm.generateObject,
    };
    await expect(scenesStep(proj, {...ctx, llm})).rejects.toMatchObject({name: 'AbortError'});
    expect(calls).toBe(2);
  });

  it('rethrows a ProviderError after exactly one LLM call', async () => {
    const {ctx, prompts} = setup(() => {
      throw new ProviderError('auth', {provider: 'x', transient: false, status: 401});
    });
    await expect(scenesStep(project(), ctx)).rejects.toBeInstanceOf(ProviderError);
    expect(prompts).toHaveLength(1);
  });

  it('applySceneResult replaces own warnings and keeps others', () => {
    const proj = project({factIds: ['f1', 'f2'], warnings: ['custom', 'Unverified figure: old', 'Scene could not be generated; simple title used']});
    const out = applySceneResult(proj.scenes[0]!, {spec: bars as SceneSpec, status: 'ok'}, proj);
    expect((out.spec as {source?: string}).source).toBe('INSEE');
    expect(out.status).toBe('ok');
    expect(out.warnings).toEqual(['custom', 'Unverified figure: Beta vaut 2 environ']);
  });

  it('passes the signal to the LLM', async () => {
    const {ctx} = setup(() => bars);
    const seen: (AbortSignal | undefined)[] = [];
    const llm = {...ctx.llm, generateObject: ((a: {signal?: AbortSignal}) => (seen.push(a.signal), ctx.llm.generateObject(a as never))) as typeof ctx.llm.generateObject};
    const signal = new AbortController().signal;
    await scenesStep(project(), {...ctx, llm, signal});
    expect(seen[0]).toBe(signal);
  });
});
