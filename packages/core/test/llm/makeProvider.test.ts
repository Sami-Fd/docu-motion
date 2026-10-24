import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {makeProvider, type RawProvider} from '../../src/llm/makeProvider.js';
import {LlmOutputError, ProviderError} from '../../src/llm/types.js';
import {redact} from '../../src/llm/redact.js';
import {createFakeProvider} from '../../src/llm/fake.js';

const schema = z.object({n: z.number()});

describe('validation loop', () => {
  it('retries with issues appended and succeeds', async () => {
    const prompts: string[] = [];
    const answers: unknown[] = ['garbage', {n: 'x'}, {n: 3}];
    const p = createFakeProvider((req) => {
      prompts.push(req.prompt);
      return answers.shift();
    });
    expect(await p.generateObject({schema, system: 's', prompt: 'P'})).toEqual({n: 3});
    expect(prompts[2]!).toContain('n: Expected number');
    expect(prompts[2]!).toContain('Return only corrected JSON.');
    expect(prompts[2]!.startsWith('P\n\nYour previous answer was invalid:')).toBe(true);
  });
  it('throws LlmOutputError after 4 calls', async () => {
    let calls = 0;
    const p = createFakeProvider(() => {
      calls++;
      return {n: 'bad'};
    });
    await expect(p.generateObject({schema, system: 's', prompt: 'P'})).rejects.toBeInstanceOf(LlmOutputError);
    expect(calls).toBe(4);
  });
  it('passes a JSON schema to the raw provider', async () => {
    let js: any;
    const raw: RawProvider = {
      name: 'x',
      capabilities: {nativeWebSearch: false, vision: false},
      object: async (a) => ((js = a.jsonSchema), {n: 1}),
      text: async () => '',
    };
    await makeProvider(raw).generateObject({schema, system: 's', prompt: 'P'});
    expect(js.properties.n.type).toBe('number');
  });
});

describe('transient retry', () => {
  const mk = (failures: number, err: Error) => {
    let calls = 0;
    const sleeps: number[] = [];
    const raw: RawProvider = {
      name: 'x',
      capabilities: {nativeWebSearch: false, vision: false},
      object: async () => {
        if (calls++ < failures) throw err;
        return {n: 1};
      },
      text: async () => 'ok',
    };
    return {p: makeProvider(raw, {sleep: async (ms) => void sleeps.push(ms)}), sleeps, calls: () => calls};
  };
  const transient = new ProviderError('rate', {provider: 'x', transient: true, status: 429});
  it('sleeps 1000 then 4000', async () => {
    const t = mk(2, transient);
    expect(await t.p.generateObject({schema, system: '', prompt: ''})).toEqual({n: 1});
    expect(t.sleeps).toEqual([1000, 4000]);
  });
  it('rethrows the third failure', async () => {
    const t = mk(3, transient);
    await expect(t.p.generateObject({schema, system: '', prompt: ''})).rejects.toBeInstanceOf(ProviderError);
    expect(t.calls()).toBe(3);
  });
  it('does not retry non-transient errors', async () => {
    const t = mk(1, new ProviderError('nope', {provider: 'x', transient: false, status: 401}));
    await expect(t.p.generateObject({schema, system: '', prompt: ''})).rejects.toThrow('nope');
    expect(t.calls()).toBe(1);
  });
  it('redacts secrets in rethrown messages', async () => {
    const raw: RawProvider = {
      name: 'x',
      capabilities: {nativeWebSearch: false, vision: false},
      object: async () => {
        throw new Error('bad key sk-abcdef123456 here');
      },
      text: async () => '',
    };
    const p = makeProvider(raw, {secrets: ['sk-abcdef123456']});
    await expect(p.generateObject({schema, system: '', prompt: ''})).rejects.toThrow('bad key *** here');
  });
});

describe('redact', () => {
  it('replaces long secrets', () => {
    expect(redact('bad key sk-abcdef123456 here', ['sk-abcdef123456'])).toBe('bad key *** here');
  });
  it('ignores short secrets', () => {
    expect(redact('abc here', ['abc'])).toBe('abc here');
  });
});
