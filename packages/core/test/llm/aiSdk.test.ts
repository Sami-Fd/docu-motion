import {APICallError} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {createApiProvider, DEFAULT_MODELS} from '../../src/llm/aiSdk.js';
import {ProviderError} from '../../src/llm/types.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const schema = z.object({n: z.number()});
const settings = SettingsSchema.parse({keys: {openai: 'sk-secret-123'}});
const ref = {kind: 'api' as const, provider: 'openai'};

const usage = {
  inputTokens: {total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0},
  outputTokens: {total: 1, text: 1, reasoning: 0},
};
const ok = (text: string) => ({
  content: [{type: 'text' as const, text}],
  finishReason: {unified: 'stop' as const, raw: 'stop'},
  usage,
  warnings: [],
});
const apiErr = (statusCode: number, message = 'boom') =>
  new APICallError({message, url: 'https://x', requestBodyValues: {}, statusCode});

describe('createApiProvider', () => {
  it('returns the parsed object', async () => {
    const model = new MockLanguageModelV4({doGenerate: ok('{"n": 4}')});
    const p = createApiProvider(ref, settings, {languageModel: model});
    expect(await p.generateObject({schema, system: 's', prompt: 'p'})).toEqual({n: 4});
    expect(p.name).toBe(`openai:${DEFAULT_MODELS.openai}`);
  });

  it('falls back to text with fenced JSON when structured output fails', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        return ok(calls === 1 ? 'not json at all' : 'Here you go:\n```json\n{"n": 7}\n```');
      },
    });
    const p = createApiProvider(ref, settings, {languageModel: model});
    expect(await p.generateObject({schema, system: 's', prompt: 'p'})).toEqual({n: 7});
    expect(calls).toBe(2);
  });

  it('retries 429 twice then succeeds', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (++calls <= 2) throw apiErr(429);
        return ok('{"n": 1}');
      },
    });
    const sleep = vi.fn(async () => {});
    const p = createApiProvider(ref, settings, {languageModel: model, sleep});
    expect(await p.generateObject({schema, system: 's', prompt: 'p'})).toEqual({n: 1});
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry 401 and redacts the key', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        throw apiErr(401, 'Incorrect API key provided: sk-secret-123');
      },
    });
    const p = createApiProvider(ref, settings, {languageModel: model, sleep: async () => {}});
    const err = await p.generateObject({schema, system: 's', prompt: 'p'}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).not.toContain('sk-secret-123');
    expect(err.status).toBe(401);
    expect(err.transient).toBe(false);
    expect(calls).toBe(1);
  });

  it('generateText returns text', async () => {
    const model = new MockLanguageModelV4({doGenerate: ok('hello')});
    const p = createApiProvider(ref, settings, {languageModel: model});
    expect(await p.generateText({system: 's', prompt: 'p'})).toBe('hello');
  });

  it('names the env var when the key is missing', () => {
    expect(() => createApiProvider(ref, SettingsSchema.parse({}))).toThrow(/OPENAI_API_KEY/);
    expect(() => createApiProvider({kind: 'api', provider: 'google'}, SettingsSchema.parse({}))).toThrow(
      /GOOGLE_GENERATIVE_AI_API_KEY/,
    );
  });

  it('rejects unknown providers', () => {
    expect(() => createApiProvider({kind: 'api', provider: 'nope'}, settings)).toThrow(/Unknown API provider/);
  });

  it('builds real providers without network and sets web search capability', () => {
    const s = SettingsSchema.parse({
      keys: {anthropic: 'a', openai: 'b', google: 'c', mistral: 'd', openrouter: 'e'},
    });
    const expected: Record<string, boolean> = {
      anthropic: true,
      openai: true,
      google: true,
      mistral: false,
      openrouter: false,
      ollama: false,
    };
    for (const [provider, web] of Object.entries(expected)) {
      const p = createApiProvider({kind: 'api', provider}, s);
      expect(p.capabilities.nativeWebSearch).toBe(web);
      expect(p.name).toBe(`${provider}:${DEFAULT_MODELS[provider]}`);
    }
    expect(createApiProvider({kind: 'api', provider: 'openai', model: 'm'}, s).name).toBe('openai:m');
  });
});
