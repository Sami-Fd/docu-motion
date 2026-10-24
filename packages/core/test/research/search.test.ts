import {describe, expect, it} from 'vitest';
import {MockLanguageModelV4} from 'ai/test';
import {braveSearch, nativeSearchFor, resolveWebSearch, sourcesToHits, tavilySearch} from '../../src/research/search.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const settings = (o: Record<string, unknown> = {}) => SettingsSchema.parse(o);
const api = (provider: string) => ({kind: 'api' as const, provider});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

describe('resolveWebSearch', () => {
  it('is off with user sources', () => {
    expect(resolveWebSearch(settings({search: 'tavily'}), api('anthropic'), true)).toBe('off');
  });
  it('auto + anthropic is native', () => {
    expect(resolveWebSearch(settings(), api('anthropic'), false)).toBe('native');
  });
  it('auto + mistral + tavily key is tavily', () => {
    expect(resolveWebSearch(settings({keys: {tavily: 'tvly-12345678'}}), api('mistral'), false)).toBe('tavily');
  });
  it('auto + mistral + brave key is brave', () => {
    expect(resolveWebSearch(settings({keys: {brave: 'brave-12345678'}}), api('mistral'), false)).toBe('brave');
  });
  it('auto + mistral + no keys is off', () => {
    expect(resolveWebSearch(settings(), api('mistral'), false)).toBe('off');
  });
  it('explicit setting wins over auto', () => {
    expect(resolveWebSearch(settings({search: 'brave'}), api('anthropic'), false)).toBe('brave');
  });
  it('auto + cli provider never picks native', () => {
    expect(resolveWebSearch(settings(), {kind: 'cli', provider: 'anthropic'}, false)).toBe('off');
  });
});

describe('tavilySearch', () => {
  it('posts the query and maps hits, preferring raw_content', async () => {
    let seen: {url: string; init: RequestInit} | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = {url, init};
      return json({
        results: [
          {title: 'A', url: 'https://a.test/', content: 'short', raw_content: 'long text'},
          {title: 'B', url: 'https://b.test/', content: 'only short', raw_content: null},
          {title: 'C', url: 'https://c.test/'},
        ],
      });
    }) as unknown as typeof fetch;
    const hits = await tavilySearch('lighthouse', 'tvly-secret-key', f);
    expect(seen!.url).toBe('https://api.tavily.com/search');
    expect(seen!.init.method).toBe('POST');
    expect(JSON.parse(seen!.init.body as string)).toEqual({query: 'lighthouse', max_results: 5, include_raw_content: true});
    expect(hits).toEqual([
      {title: 'A', url: 'https://a.test/', content: 'long text'},
      {title: 'B', url: 'https://b.test/', content: 'only short'},
      {title: 'C', url: 'https://c.test/'},
    ]);
  });
  it('throws a redacted error on HTTP failure', async () => {
    const f = (async () => new Response('bad key tvly-secret-key', {status: 401})) as unknown as typeof fetch;
    const err = await tavilySearch('q', 'tvly-secret-key', f).then(() => new Error('did not throw'), (e: Error) => e);
    expect(err.message).toContain('401');
    expect(err.message).not.toContain('tvly-secret-key');
  });
});

describe('braveSearch', () => {
  it('sends the token header and maps hits without content', async () => {
    let seen: {url: string; init: RequestInit} | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = {url, init};
      return json({web: {results: [{title: 'A', url: 'https://a.test/', description: 'x'}]}});
    }) as unknown as typeof fetch;
    const hits = await braveSearch('phare été', 'brave-secret-key', f);
    expect(seen!.url).toBe(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent('phare été')}&count=5`);
    expect((seen!.init.headers as Record<string, string>)['X-Subscription-Token']).toBe('brave-secret-key');
    expect(hits).toEqual([{title: 'A', url: 'https://a.test/'}]);
  });
  it('redacts the key in thrown errors', async () => {
    const f = (async () => {
      throw new Error('boom brave-secret-key');
    }) as unknown as typeof fetch;
    const err = await braveSearch('q', 'brave-secret-key', f).then(() => new Error('did not throw'), (e: Error) => e);
    expect(err.message).not.toContain('brave-secret-key');
  });
});

describe('sourcesToHits', () => {
  it('keeps url sources only and falls back to the url as title', () => {
    expect(
      sourcesToHits([
        {type: 'source', sourceType: 'url', id: '1', url: 'https://a.test/', title: 'A'},
        {type: 'source', sourceType: 'url', id: '2', url: 'https://b.test/'},
        {type: 'source', sourceType: 'document', id: '3', mediaType: 'x', title: 'D'},
      ]),
    ).toEqual([
      {title: 'A', url: 'https://a.test/'},
      {title: 'https://b.test/', url: 'https://b.test/'},
    ]);
  });
});

describe('nativeSearchFor', () => {
  it('is undefined for providers without native search', () => {
    expect(nativeSearchFor(api('mistral'), settings())).toBeUndefined();
    expect(nativeSearchFor({kind: 'cli', provider: 'anthropic'}, settings())).toBeUndefined();
  });
  it('returns hits from the model sources (injected mock model)', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {type: 'text', text: 'ok'},
          {type: 'source', sourceType: 'url', id: 'x', url: 'https://a.test/', title: 'A'},
        ],
        finishReason: {unified: 'stop', raw: 'stop'},
        usage: {
          inputTokens: {total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0},
          outputTokens: {total: 1, text: 1, reasoning: 0},
        },
        warnings: [],
      }),
    });
    const search = nativeSearchFor(api('anthropic'), settings(), {languageModel: model});
    expect(search).toBeTypeOf('function');
    expect(await search!('q')).toEqual([{title: 'A', url: 'https://a.test/'}]);
  });
});
