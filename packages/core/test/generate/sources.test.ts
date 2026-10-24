import {existsSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import type {StepContext} from '../../src/generate/context.js';
import {sourcesStep} from '../../src/generate/steps/sources.js';
import {createFakeProvider} from '../../src/llm/fake.js';
import type {Project} from '../../src/project/schema.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const KEY = 'tvly-secret-key';
const project = (brief: Partial<Project['brief']> = {}): Project =>
  ({
    version: 1,
    brief: {
      topic: 'Phare',
      language: 'fr',
      targetMinutes: 2,
      style: 'papier',
      provider: {kind: 'fake', provider: 'fake'},
      webSearch: 'tavily',
      sources: [],
      ...brief,
    },
    sources: [],
    facts: [],
    scenes: [],
    voice: {engine: 'none'},
    progress: {done: []},
  }) as Project;

function setup(fetchImpl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dm été sources '));
  const logs: string[] = [];
  const calls: string[] = [];
  const llmCalls: string[] = [];
  const llm = createFakeProvider(({prompt}) => {
    llmCalls.push(prompt);
    return {queries: ['a', 'b']};
  });
  const ctx: StepContext = {
    projectDir: dir,
    llm,
    settings: SettingsSchema.parse({keys: {tavily: KEY}}),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      return fetchImpl(String(url), init);
    }) as unknown as typeof fetch,
    onProgress: (e) => {
      if (e.log) logs.push(e.log);
    },
  };
  return {dir, ctx, logs, calls, llmCalls};
}

const tavily = (results: unknown[]) =>
  new Response(JSON.stringify({results}), {status: 200, headers: {'content-type': 'application/json'}});
const html = (body: string) => new Response(body, {status: 200, headers: {'content-type': 'text/html'}});

describe('sourcesStep', () => {
  it('keeps up to 6 unique search URLs as kind search with text files', async () => {
    const hitsFor = (q: string) =>
      [1, 2, 3, 4].map((i) => ({
        title: `T${q}${i}`,
        // query a: /1../4; query b: /3 and /4 are duplicates (case, fragment, trailing slash), then /5, /6
        url: q === 'a' ? `https://x.test/${i}` : ['https://X.test/3/#frag', 'https://x.test/4/', 'https://x.test/5', 'https://x.test/6'][i - 1]!,
        content: `content ${q}${i}`,
      }));
    const {dir, ctx} = setup((url, init) => {
      expect(url).toBe('https://api.tavily.com/search');
      return tavily(hitsFor(JSON.parse(init!.body as string).query));
    });
    const out = await sourcesStep(project(), ctx);
    expect(out.sources).toHaveLength(6);
    expect(out.sources.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(out.sources.every((s) => s.kind === 'search')).toBe(true);
    expect(new Set(out.sources.map((s) => s.uri)).size).toBe(6);
    for (const s of out.sources) expect(existsSync(path.join(dir, s.textPath))).toBe(true);
    expect(readFileSync(path.join(dir, 'sources/s1.txt'), 'utf8')).toBe('content a1');
  });

  it('caps search sources at 6', async () => {
    const {ctx} = setup((_u, init) => {
      const q = JSON.parse(init!.body as string).query;
      return tavily([1, 2, 3, 4, 5].map((i) => ({title: 't', url: `https://x.test/${q}${i}`, content: 'c'})));
    });
    const out = await sourcesStep(project(), ctx);
    expect(out.sources).toHaveLength(6);
  });

  it('with webSearch off and one user URL makes no LLM call and ids start at s1', async () => {
    const {ctx, llmCalls, logs} = setup(() => html('<html><body><p>hello world</p></body></html>'));
    const out = await sourcesStep(project({webSearch: 'off', sources: ['https://u.test/a']}), ctx);
    expect(llmCalls).toHaveLength(0);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({id: 's1', kind: 'url', uri: 'https://u.test/a'});
    expect(logs.at(-1)).toBe('1 sources (0 failed)');
  });

  it('replaces previously ingested sources on rerun', async () => {
    const {ctx} = setup(() => tavily([]));
    const p = project();
    p.sources = [{id: 's1', kind: 'url', title: 'old', uri: 'https://old.test', textPath: 'sources/s1.txt'}];
    const out = await sourcesStep(p, ctx);
    expect(out.sources).toEqual([]);
  });

  it('fetches search hits that carry no content', async () => {
    const { ctx, calls } = setup((url) =>
      url.startsWith('https://api.tavily.com')
        ? tavily([{title: 'N', url: 'https://n.test/p'}])
        : html('<html><body><p>fetched body</p></body></html>'),
    );
    const out = await sourcesStep(project(), ctx);
    expect(calls).toContain('https://n.test/p');
    expect(out.sources[0]).toMatchObject({kind: 'search', uri: 'https://n.test/p'});
  });

  it('survives a search API 500: zero sources, failure logged, key not leaked', async () => {
    const {ctx, logs} = setup(() => new Response(`oops ${KEY}`, {status: 500}));
    const out = await sourcesStep(project(), ctx);
    expect(out.sources).toEqual([]);
    expect(logs.some((l) => /fail/i.test(l) && l.includes('500'))).toBe(true);
    expect(logs.at(-1)).toBe('0 sources (0 failed)');
    expect(logs.join('\n')).not.toContain(KEY);
  });

  it('uses ctx.nativeSearch for native', async () => {
    const {ctx} = setup(() => {
      throw new Error('no network');
    });
    ctx.nativeSearch = async (q) => [{title: q, url: `https://n.test/${q}`, content: `c ${q}`}];
    const out = await sourcesStep(project({webSearch: 'native'}), ctx);
    expect(out.sources.map((s) => s.uri)).toEqual(['https://n.test/a', 'https://n.test/b']);
  });

  it('aborts promptly during a search fetch and starts no further fetch', async () => {
    const ac = new AbortController();
    const {ctx, calls} = setup((_u, init) => new Promise<Response>((_r, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    }));
    ctx.signal = ac.signal;
    const run = sourcesStep(project(), ctx);
    setTimeout(() => ac.abort(), 20);
    await expect(run).rejects.toMatchObject({name: 'AbortError'});
    expect(calls).toHaveLength(1);
  });

  it('aborts during user source ingestion', async () => {
    const ac = new AbortController();
    const {ctx, calls} = setup((_u, init) => new Promise<Response>((_r, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    }));
    ctx.signal = ac.signal;
    const run = sourcesStep(project({webSearch: 'off', sources: ['https://u.test/a', 'https://u.test/b']}), ctx);
    setTimeout(() => ac.abort(), 20);
    await expect(run).rejects.toMatchObject({name: 'AbortError'});
    expect(calls).toHaveLength(1);
  });

  it('logs a per-query failure and counts failed sources on partial success', async () => {
    const {ctx, logs} = setup((url, init) => {
      if (url.startsWith('https://api.tavily.com')) {
        if (JSON.parse(init!.body as string).query === 'a') return new Response('x', {status: 500});
        return tavily([{title: 'N', url: 'https://n.test/p'}]);
      }
      return new Response('gone', {status: 404});
    });
    const out = await sourcesStep(project(), ctx);
    expect(logs.some((l) => l.startsWith('Search failed for'))).toBe(true);
    expect(out.sources).toHaveLength(1);
    expect(logs.at(-1)).toBe('1 sources (1 failed)');
  });

  it.each([
    ['4 queries', ['a', 'b', 'c', 'd']],
    ['an overlong query', ['x'.repeat(121)]],
  ])('skips search with a log when the LLM returns %s', async (_n, queries) => {
    const {ctx, logs, calls} = setup(() => tavily([]));
    ctx.llm = createFakeProvider(() => ({queries}));
    const out = await sourcesStep(project(), ctx);
    expect(out.sources).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(logs.some((l) => l.startsWith('Web search skipped'))).toBe(true);
  });
});
