import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {defaultDataDir, loadSettings, requireProvider, saveSettings} from '../../src/settings/settings.js';

const tmp = () => mkdtemp(path.join(tmpdir(), 'dm-é settings-'));

describe('settings', () => {
  it('applies defaults without config.json', async () => {
    const s = await loadSettings(await tmp(), {});
    expect(s.ollamaBaseUrl).toBe('http://localhost:11434/v1');
    expect(s.defaultLanguage).toBe('fr');
    expect(s.search).toBe('auto');
    expect(s.keys).toEqual({});
  });
  it('lets env override', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, 'config.json'), JSON.stringify({keys: {openai: 'file'}}));
    const s = await loadSettings(dir, {OPENAI_API_KEY: 'k', OLLAMA_BASE_URL: 'http://x/v1'});
    expect(s.keys.openai).toBe('k');
    expect(s.ollamaBaseUrl).toBe('http://x/v1');
  });
  it('reads ELEVENLABS_API_KEY from env', async () => {
    const s = await loadSettings(await tmp(), {ELEVENLABS_API_KEY: 'el-key'});
    expect(s.keys.elevenlabs).toBe('el-key');
  });
  it('round-trips', async () => {
    const dir = await tmp();
    const s = await loadSettings(dir, {});
    s.defaultLanguage = 'en';
    s.keys.tavily = 'tv';
    await saveSettings(dir, s);
    expect(await loadSettings(dir, {})).toEqual(s);
  });
  it('defaultDataDir honours DOCU_MOTION_DATA', () => {
    const old = process.env.DOCU_MOTION_DATA;
    process.env.DOCU_MOTION_DATA = 'X';
    expect(defaultDataDir()).toBe('X');
    if (old === undefined) delete process.env.DOCU_MOTION_DATA;
    else process.env.DOCU_MOTION_DATA = old;
  });
  it('defaultDataDir falls back to <repo>/data', () => {
    const old = process.env.DOCU_MOTION_DATA;
    delete process.env.DOCU_MOTION_DATA;
    expect(defaultDataDir()).toBe(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'data'));
    if (old !== undefined) process.env.DOCU_MOTION_DATA = old;
  });
});

describe('settings safety', () => {
  it('requireProvider throws without a provider and returns it otherwise', async () => {
    const s = await loadSettings(await tmp(), {});
    expect(s.provider).toBeUndefined();
    expect(() => requireProvider(s)).toThrow('No AI provider configured');
    expect(requireProvider({...s, provider: {kind: 'fake', provider: 'fake'}})).toEqual({kind: 'fake', provider: 'fake'});
  });
  it('never writes env-sourced values to config.json', async () => {
    const dir = await tmp();
    const env = {OPENAI_API_KEY: 'sk-from-env-123456', TAVILY_API_KEY: 'tv-env-123456', OLLAMA_BASE_URL: 'http://env/v1'};
    await writeFile(path.join(dir, 'config.json'), JSON.stringify({keys: {tavily: 'file-tv'}}));
    const s = await loadSettings(dir, env);
    s.defaultLanguage = 'en';
    await saveSettings(dir, s, env);
    const text = await readFile(path.join(dir, 'config.json'), 'utf8');
    expect(text).not.toContain('sk-from-env');
    expect(text).not.toContain('tv-env');
    expect(text).not.toContain('http://env');
    const back = await loadSettings(dir, {});
    expect(back.keys.tavily).toBe('file-tv');
    expect(back.defaultLanguage).toBe('en');
  });
  it('invalid config.json error names only the path', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, 'config.json'), '{ "keys": SECRET-snippet');
    const err = (await loadSettings(dir, {}).catch((e) => e)) as Error;
    expect(err.message).toContain('config.json');
    expect(err.message).not.toContain('SECRET-snippet');
  });
});
