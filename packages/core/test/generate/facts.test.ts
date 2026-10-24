import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import type {StepContext} from '../../src/generate/context.js';
import {factsStep} from '../../src/generate/steps/facts.js';
import {createFakeProvider} from '../../src/llm/fake.js';
import type {Project} from '../../src/project/schema.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const project = (sources: Project['sources'] = []): Project =>
  ({
    version: 1,
    brief: {topic: 'CSG', language: 'fr', targetMinutes: 2, style: 'papier', provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off', sources: []},
    sources,
    facts: [],
    scenes: [],
    voice: {engine: 'none'},
    progress: {done: []},
  }) as Project;

function setup(respond: (prompt: string) => unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dm été facts '));
  const prompts: string[] = [];
  const ctx: StepContext = {
    projectDir: dir,
    llm: createFakeProvider(({prompt}) => {
      prompts.push(prompt);
      return respond(prompt);
    }),
    settings: SettingsSchema.parse({}),
    fetch: (async () => new Response('')) as unknown as typeof fetch,
    onProgress: () => {},
  };
  return {dir, ctx, prompts};
}
const src = (id: string, extra = {}) => ({id, kind: 'url' as const, title: id, uri: `https://x/${id}`, textPath: `sources/${id}.txt`, ...extra});
const write = (dir: string, id: string, text: string) => {
  mkdirSync(path.join(dir, 'sources'), {recursive: true});
  writeFileSync(path.join(dir, 'sources', `${id}.txt`), text);
};

describe('factsStep', () => {
  it('verifies real excerpts only and assigns ids', async () => {
    const {dir, ctx, prompts} = setup(() => ({
      facts: [
        {statement: 'A', sourceId: 's1', excerpt: 'la  CSG finance 20 %'},
        {statement: 'B', sourceId: 's1', excerpt: 'la CSG finance la moitié du monde'},
        {statement: 'C', sourceId: 's9', excerpt: 'la CSG finance 20 %'},
      ],
    }));
    write(dir, 's1', 'Selon le rapport, la CSG finance 20\u202f% des recettes');
    const out = await factsStep(project([src('s1')]), ctx);
    expect(out.facts.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(out.facts.map((f) => f.verified)).toEqual([true, false, false]);
    expect(prompts[0]).toContain('s1');
    expect(prompts[0]).not.toContain('from your own knowledge');
  });

  it('uses model knowledge and leaves facts unverified with no sources', async () => {
    const {ctx, prompts} = setup(() => ({
      facts: [1, 2, 3].map((i) => ({statement: `F${i}`, sourceId: 's1', excerpt: 'some long excerpt text'})),
    }));
    const out = await factsStep(project(), ctx);
    expect(prompts[0]).toContain('from your own knowledge');
    expect(out.facts.every((f) => !f.verified)).toBe(true);
  });

  it('skips errored and empty sources', async () => {
    const {dir, ctx, prompts} = setup(() => ({facts: [1, 2, 3].map((i) => ({statement: `F${i}`}))}));
    write(dir, 's1', 'text');
    write(dir, 's2', '   ');
    await factsStep(project([src('s1', {error: 'boom'}), src('s2')]), ctx);
    expect(prompts[0]).toContain('from your own knowledge');
  });

  it('caps per source and total on whitespace boundaries', async () => {
    const {dir, ctx, prompts} = setup(() => ({facts: [1, 2, 3].map((i) => ({statement: `F${i}`}))}));
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6'];
    for (const id of ids) write(dir, id, 'mot '.repeat(5000));
    await factsStep(project(ids.map((i) => src(i))), ctx);
    const prompt = prompts[0] ?? "";
    expect(prompt.length).toBeLessThan(62_000 + 3000);
    expect(prompt).not.toContain('s6');
    expect(prompt).not.toMatch(/mo\b(?!t)/);
  });

  it('passes the abort signal to the LLM', async () => {
    const {ctx} = setup(() => ({facts: []}));
    const ac = new AbortController();
    ac.abort();
    await expect(factsStep(project(), {...ctx, signal: ac.signal})).rejects.toBeDefined();
  });
});
