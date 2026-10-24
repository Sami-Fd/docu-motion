import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {z} from 'zod';
import {createCliProvider} from '../../src/llm/cli.js';
import {createProvider} from '../../src/llm/registry.js';
import {ProviderError} from '../../src/llm/types.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const fixture = fileURLToPath(new URL('../fixtures/fake-cli.mjs', import.meta.url));
const deps = {command: process.execPath, args: [fixture]};
const schema = z.object({n: z.number()});

afterEach(() => {
  delete process.env.FAKE_CLI_MODE;
});

describe('createCliProvider', () => {
  it('has the expected name and capabilities', () => {
    const p = createCliProvider({kind: 'cli', provider: 'codex'}, deps);
    expect(p.name).toBe('cli:codex');
    expect(p.capabilities).toEqual({nativeWebSearch: false, vision: false});
  });

  it('extracts fenced JSON from chatter and validates', async () => {
    process.env.FAKE_CLI_MODE = 'fenced';
    const p = createCliProvider({kind: 'cli', provider: 'codex'}, deps);
    expect(await p.generateObject({schema, system: 's', prompt: 'p'})).toEqual({n: 3});
  });

  it('parses the result field of claude JSON output', async () => {
    process.env.FAKE_CLI_MODE = 'claude';
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, deps);
    expect(await p.generateObject({schema, system: 's', prompt: 'p'})).toEqual({n: 3});
    expect(await p.generateText({system: 's', prompt: 'p'})).toBe('{"n":3}');
  });

  it('sends the prompt on stdin, not argv', async () => {
    process.env.FAKE_CLI_MODE = 'echo';
    const p = createCliProvider({kind: 'cli', provider: 'gemini'}, deps);
    const out = JSON.parse(await p.generateText({system: 'SYS', prompt: 'secret prompt'}));
    expect(out.input).toContain('SYS');
    expect(out.input).toContain('secret prompt');
    expect(JSON.stringify(out.args)).not.toContain('secret prompt');
  });

  it('turns a non-zero exit into a ProviderError with stderr', async () => {
    process.env.FAKE_CLI_MODE = 'fail';
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, deps);
    const err = await p.generateText({system: 's', prompt: 'p'}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('not logged in');
  });

  it('reports a missing binary', async () => {
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, {command: 'definitely-not-a-real-cli-xyz'});
    const err = await p.generateText({system: 's', prompt: 'p'}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('not found');
    expect(err.transient).toBe(false);
  });

  it('rejects quickly on abort', async () => {
    process.env.FAKE_CLI_MODE = 'sleep';
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, deps);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const start = Date.now();
    await expect(p.generateText({system: 's', prompt: 'p', signal: ac.signal})).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('is wired into createProvider', () => {
    const p = createProvider({kind: 'cli', provider: 'gemini'}, SettingsSchema.parse({}));
    expect(p.name).toBe('cli:gemini');
  });
});
