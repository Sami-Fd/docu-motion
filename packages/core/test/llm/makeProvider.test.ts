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

describe('redaction depth and abort', () => {
  const caps = {nativeWebSearch: false, vision: false};
  const SECRET = 'sk-abcdef123456';
  it('leaves the secret nowhere reachable on the thrown error', async () => {
    const inner = new Error(`inner ${SECRET}`);
    const err: any = new Error(`outer ${SECRET}`, {cause: inner});
    err.url = `https://x/?key=${SECRET}`;
    err.requestBodyValues = {k: SECRET};
    err.status = 401;
    const p = makeProvider(
      {name: 'x', capabilities: caps, object: async () => { throw err; }, text: async () => ''},
      {secrets: [SECRET]},
    );
    const e: any = await p.generateObject({schema, system: '', prompt: ''}).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.status).toBe(401);
    expect(JSON.stringify(e, Object.getOwnPropertyNames(e))).not.toContain(SECRET);
    expect(String(e.stack)).not.toContain(SECRET);
    expect(e.message).toContain('***');
  });
  it('redacts the cause chain of a ProviderError and wraps non-Errors', async () => {
    const pe = new ProviderError(`m ${SECRET}`, {provider: 'x', transient: false});
    (pe as any).cause = new Error(`c ${SECRET}`);
    const p = makeProvider(
      {name: 'x', capabilities: caps, object: async () => { throw pe; }, text: async () => { throw `str ${SECRET}`; }},
      {secrets: [SECRET]},
    );
    const e: any = await p.generateObject({schema, system: '', prompt: ''}).catch((x) => x);
    expect(e.cause.message).not.toContain(SECRET);
    expect(e.stack).not.toContain(SECRET);
    const t: any = await p.generateText({system: '', prompt: ''}).catch((x) => x);
    expect(t).toBeInstanceOf(ProviderError);
    expect(t.message).not.toContain(SECRET);
  });
  it('aborts during the backoff without another raw call', async () => {
    let calls = 0;
    const ac = new AbortController();
    const p = makeProvider(
      {
        name: 'x',
        capabilities: caps,
        object: async () => {
          calls++;
          throw new ProviderError('rate', {provider: 'x', transient: true, status: 429});
        },
        text: async () => '',
      },
      {sleep: () => new Promise<void>(() => {})},
    );
    const pr = p.generateObject({schema, system: '', prompt: '', signal: ac.signal}).catch((x) => x);
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    const e: any = await pr;
    expect(e.message).toMatch(/abort/i);
    expect(calls).toBe(1);
  });
  it('stops the validation loop when aborted between attempts', async () => {
    let calls = 0;
    const ac = new AbortController();
    const p = makeProvider({
      name: 'x',
      capabilities: caps,
      object: async () => {
        calls++;
        ac.abort();
        return {n: 'bad'};
      },
      text: async () => '',
    });
    const e: any = await p.generateObject({schema, system: '', prompt: '', signal: ac.signal}).catch((x) => x);
    expect(e.message).toMatch(/abort/i);
    expect(calls).toBe(1);
  });
});
