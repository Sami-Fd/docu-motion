import {APICallError} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {buildModel, createApiProvider, DEFAULT_MODELS, toProviderError} from '../../src/llm/aiSdk.js';
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

  it('falls back to text when the structured call is rejected with HTTP 400 (strict schema)', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (++calls === 1) throw apiErr(400, "Invalid schema for response_format 'facts': 'required' is required");
        return ok('Sure:\n```json\n{"n": 9}\n```');
      },
    });
    const p = createApiProvider(ref, settings, {languageModel: model, sleep: async () => {}});
    expect(await p.generateObject({schema, system: 's', prompt: 'p'})).toEqual({n: 9});
    expect(calls).toBe(2);
    expect(model.doGenerateCalls[0]!.responseFormat?.type).toBe('json');
    expect(model.doGenerateCalls[1]!.responseFormat?.type ?? 'text').toBe('text');
  });

  it('does not fall back on an unrelated 400 and hints the key for a Google bad-key 400', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        throw apiErr(400, 'API key not valid. Please pass a valid API key.');
      },
    });
    const g = createApiProvider({kind: 'api', provider: 'google'}, {...settings, keys: {...settings.keys, google: 'k'}}, {
      languageModel: model,
      sleep: async () => {},
    });
    await expect(g.generateObject({schema, system: 's', prompt: 'p'})).rejects.toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
    expect(calls).toBe(1);
  });

  it('matches the 400 fallback against the response body too', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (++calls === 1) {
          throw new APICallError({message: 'Bad Request', url: 'https://x', requestBodyValues: {}, statusCode: 400, responseBody: '{"error":"Invalid schema for response_format"}'});
        }
        return ok('{"n": 5}');
      },
    });
    const p = createApiProvider(ref, settings, {languageModel: model, sleep: async () => {}});
    expect(await p.generateObject({schema, system: 's', prompt: 'p'})).toEqual({n: 5});
    expect(calls).toBe(2);
  });

  it('does not fall back on a 401 from the structured call', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        throw apiErr(401);
      },
    });
    const p = createApiProvider(ref, settings, {languageModel: model, sleep: async () => {}});
    await expect(p.generateObject({schema, system: 's', prompt: 'p'})).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
  });

  it('turns off strict JSON schema for OpenAI structured calls', async () => {
    const model = new MockLanguageModelV4({doGenerate: ok('{"n": 4}')});
    const p = createApiProvider(ref, settings, {languageModel: model});
    await p.generateObject({schema, system: 's', prompt: 'p'});
    expect(model.doGenerateCalls[0]!.providerOptions).toEqual({openai: {strictJsonSchema: false}});
  });

  it('turns off strict structured outputs for OpenRouter models', () => {
    const s = SettingsSchema.parse({keys: {openrouter: 'e'}});
    const m = buildModel('openrouter', 'x/y', s) as unknown as {settings: {structuredOutputs?: {strict?: boolean}}};
    expect(m.settings.structuredOutputs?.strict).toBe(false);
  });

  it('names the provider and status in API errors, with a key hint for 401/403', () => {
    const e401 = toProviderError(apiErr(401, 'Invalid x-api-key sk-secret-123'), 'anthropic', ['sk-secret-123']) as Error;
    expect(e401.message).toMatch(/^Anthropic API error \(HTTP 401\): /);
    expect(e401.message).toContain('check the key in Settings or ANTHROPIC_API_KEY');
    expect(e401.message).not.toContain('sk-secret-123');
    const e403 = toProviderError(apiErr(403), 'openai', []) as Error;
    expect(e403.message).toContain('check the key in Settings or OPENAI_API_KEY');
    const e500 = toProviderError(apiErr(500, 'overloaded'), 'mistral', []) as Error;
    expect(e500.message).toBe('Mistral API error (HTTP 500): overloaded');
    const net = new APICallError({message: 'Cannot connect', url: 'https://x', requestBodyValues: {}, isRetryable: true});
    expect((toProviderError(net, 'google', []) as Error).message).toBe('Google API error: Cannot connect');
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

  const retried = async (err: unknown) => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (++calls === 1) throw err;
        return ok('{"n": 1}');
      },
    });
    const p = createApiProvider(ref, settings, {languageModel: model, sleep: async () => {}});
    expect(await p.generateObject({schema, system: 's', prompt: 'p'})).toEqual({n: 1});
    return calls;
  };

  it('retries a 503', async () => {
    expect(await retried(apiErr(503))).toBe(2);
  });

  it('retries a network failure (no status, isRetryable)', async () => {
    const e = new APICallError({message: 'Cannot connect', url: 'https://x', requestBodyValues: {}, isRetryable: true});
    expect(await retried(e)).toBe(2);
  });

  it('retries a TimeoutError', async () => {
    const e = new Error('timed out');
    e.name = 'TimeoutError';
    expect(await retried(e)).toBe(2);
  });

  it('passes a user abort through unwrapped and unretried', async () => {
    const ac = new AbortController();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        ac.abort();
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        throw e;
      },
    });
    const p = createApiProvider(ref, settings, {languageModel: model, sleep: async () => {}});
    const err = await p.generateObject({schema, system: 's', prompt: 'p', signal: ac.signal}).catch((e) => e);
    expect(err).not.toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(/abort/i);
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
      expect(p.capabilities.vision).toBe(provider !== 'mistral' && provider !== 'ollama');
      expect(p.name).toBe(`${provider}:${DEFAULT_MODELS[provider]}`);
    }
    expect(createApiProvider({kind: 'api', provider: 'openai', model: 'm'}, s).name).toBe('openai:m');
  });
});
