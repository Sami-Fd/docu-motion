import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {defaultDataDir, loadSettings, saveSettings} from '../../src/settings/settings.js';

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
    expect(path.basename(defaultDataDir())).toBe('data');
    expect(path.basename(path.dirname(defaultDataDir()))).toBe('docu-motion');
    if (old !== undefined) process.env.DOCU_MOTION_DATA = old;
  });
});
