import {existsSync, readdirSync, realpathSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {z} from 'zod';
import {CLI_ARGS, createCliProvider, planSpawn} from '../../src/llm/cli.js';
import {createProvider} from '../../src/llm/registry.js';
import {ProviderError} from '../../src/llm/types.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const fixture = fileURLToPath(new URL('../fixtures/fake-cli.mjs', import.meta.url));
const deps = {command: process.execPath, args: [fixture]};
const schema = z.object({n: z.number()});

const inside = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const listCliDirs = () => readdirSync(os.tmpdir()).filter((d) => d.startsWith('docu-motion-cli-'));

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

  it('runs the CLI in a fresh empty temp dir, not the repo, and removes it afterwards', async () => {
    process.env.FAKE_CLI_MODE = 'echo';
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, deps);
    const out = JSON.parse(await p.generateText({system: 's', prompt: 'p'})) as {cwd: string};
    const repo = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
    expect(inside(repo, out.cwd)).toBe(false);
    expect(out.cwd).not.toBe(process.cwd());
    expect(inside(realpathSync(os.tmpdir()), out.cwd) || inside(os.tmpdir(), out.cwd)).toBe(true);
    expect(path.basename(out.cwd)).toMatch(/^docu-motion-cli-/);
    expect(existsSync(out.cwd)).toBe(false);
  });

  it('removes the temp dir after a failure too', async () => {
    process.env.FAKE_CLI_MODE = 'fail';
    const before = new Set(listCliDirs());
    const p = createCliProvider({kind: 'cli', provider: 'codex'}, deps);
    await p.generateText({system: 's', prompt: 'p'}).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(listCliDirs().filter((d) => !before.has(d))).toEqual([]);
  });

  it('passes tool-restricting flags to claude and codex', () => {
    expect(CLI_ARGS.claude.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(CLI_ARGS.claude).toEqual(expect.arrayContaining(['--max-turns', '1', '--disallowedTools', 'Bash', 'Read', 'Write', 'Edit']));
    expect(CLI_ARGS.codex).toEqual(['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-']);
    expect(CLI_ARGS.gemini).toEqual(['-p']);
    for (const a of Object.values(CLI_ARGS).flat()) expect(a).toMatch(/^[\w.-]+$/); // safe for the cmd.exe command line
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
    await expect(p.generateText({system: 's', prompt: 'p', signal: ac.signal})).rejects.toMatchObject({name: 'AbortError'});
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('round-trips accented UTF-8 prompts', async () => {
    process.env.FAKE_CLI_MODE = 'echo';
    const p = createCliProvider({kind: 'cli', provider: 'gemini'}, deps);
    const out = JSON.parse(await p.generateText({system: 's', prompt: 'été — 日本語 😀'}));
    expect(out.input).toContain('été — 日本語 😀');
  });

  it('throws on claude is_error output even with exit 0', async () => {
    process.env.FAKE_CLI_MODE = 'claude-error';
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, deps);
    const err = await p.generateText({system: 's', prompt: 'p'}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Invalid API key');
    expect(err.transient).toBe(false);
  });

  it('reads the claude error from stdout on non-zero exit', async () => {
    process.env.FAKE_CLI_MODE = 'claude-fail';
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, deps);
    const err = await p.generateText({system: 's', prompt: 'p'}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Please run /login');
  });

  it('times out as a non-transient error', async () => {
    process.env.FAKE_CLI_MODE = 'sleep';
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, {...deps, timeoutMs: 200});
    const err = await p.generateText({system: 's', prompt: 'p'}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.transient).toBe(false);
    expect(err.message).toContain('timed out');
  });

  it('kills the child when stdout exceeds the cap', async () => {
    process.env.FAKE_CLI_MODE = 'big';
    const p = createCliProvider({kind: 'cli', provider: 'claude'}, {...deps, maxStdoutBytes: 1024});
    const err = await p.generateText({system: 's', prompt: 'p'}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.transient).toBe(false);
    expect(err.message).toContain('output');
  });

  it('is wired into createProvider', () => {
    const p = createProvider({kind: 'cli', provider: 'gemini'}, SettingsSchema.parse({}));
    expect(p.name).toBe('cli:gemini');
  });
});

describe('planSpawn', () => {
  const A = String.raw`C:\npm\ `.trim();
  const EXE = String.raw`C:\bin\claude.exe`;
  it('prefers .exe', () => {
    const p = planSpawn(`${A}claude\r\n${A}claude.cmd\r\n${EXE}\r\n`, 'win32', 'claude', ['-p']);
    expect(p).toEqual({file: EXE, args: ['-p'], verbatim: false});
  });
  it('picks .cmd over extensionless and .ps1', () => {
    const p = planSpawn(`${A}claude\r\n${A}claude.cmd\r\n${A}claude.ps1\r\n`, 'win32', 'claude', ['-p'], 'cmd.exe');
    expect(p?.file).toBe('cmd.exe');
    expect(p?.args.at(-1)).toContain('claude.cmd');
    expect(p?.verbatim).toBe(true);
  });
  it('ignores extensionless-only results', () => {
    expect(planSpawn(`${A}claude\r\n`, 'win32', 'claude', [])).toBeUndefined();
  });
  it('refuses paths with & or %', () => {
    expect(planSpawn(String.raw`C:\a&b\claude.cmd`, 'win32', 'claude', [])).toBeUndefined();
    expect(planSpawn(String.raw`C:\%TEMP%\claude.cmd`, 'win32', 'claude', [])).toBeUndefined();
  });
});
