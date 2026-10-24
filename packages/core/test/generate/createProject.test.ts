import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createProject, slugify, type NewProjectInput} from '../../src/generate/createProject.js';
import {loadProject} from '../../src/project/store.js';

describe('slugify', () => {
  it('strips accents and punctuation', () => {
    expect(slugify('Qui finance la Sécu ?')).toBe('qui-finance-la-secu');
  });
  it('falls back to video', () => {
    expect(slugify('🎬/\:*?')).toBe('video');
  });
  it('cuts long topics on a dash', () => {
    const s = slugify('abcdefg '.repeat(25));
    expect(s.length).toBeLessThanOrEqual(32);
    expect(s.endsWith('-')).toBe(false);
    expect(s.length).toBeGreaterThan(0);
  });
});

describe('createProject', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'données é-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, {recursive: true, force: true});
  });
  const input = (sources: string[] = []): NewProjectInput => ({
    topic: 'Qui finance la Sécu ?',
    style: 'papier',
    language: 'fr',
    targetMinutes: 2,
    provider: {kind: 'fake', provider: 'fake'},
    webSearch: 'off',
    sources,
    voice: {engine: 'none'},
  });
  const now = new Date(2026, 9, 24, 13, 5, 9);

  it('creates a loadable project with a safe folder name', async () => {
    const dir = await createProject(tmp, input(), now);
    expect(path.basename(dir)).toMatch(/^[a-z0-9-]{1,48}$/);
    expect(path.basename(dir)).toBe('qui-finance-la-secu-20261024-130509');
    const p = await loadProject(dir);
    expect(p.scenes).toEqual([]);
    expect(p.sources).toEqual([]);
    expect(p.facts).toEqual([]);
    expect(p.progress.done).toEqual([]);
  });

  it('gives distinct dirs for the same instant', async () => {
    const a = await createProject(tmp, input(), now);
    const b = await createProject(tmp, input(), now);
    expect(a).not.toBe(b);
    expect(path.basename(b)).toMatch(/-2$/);
    expect(path.basename(a).length).toBeLessThanOrEqual(48);
    expect(path.basename(b).length).toBeLessThanOrEqual(48);
  });

  it('copies local files and keeps URLs', async () => {
    const f = path.join(tmp, 'note é.txt');
    await fs.writeFile(f, 'hello');
    const dir = await createProject(tmp, input([f, 'https://example.com/a']), now);
    const p = await loadProject(dir);
    expect(p.brief.sources).toEqual(['sources/upload/note é.txt', 'https://example.com/a']);
    expect(await fs.readFile(path.join(dir, 'sources/upload/note é.txt'), 'utf8')).toBe('hello');
  });

  it('keeps long-topic folder names within 48 chars including suffix', async () => {
    const long = {...input(), topic: 'a'.repeat(200)};
    await createProject(tmp, long, now);
    const b = await createProject(tmp, long, now);
    expect(path.basename(b).length).toBeLessThanOrEqual(48);
    expect(path.basename(b)).toMatch(/^[a-z0-9-]+$/);
  });

  it('renames case-insensitive duplicate basenames', async () => {
    await fs.mkdir(path.join(tmp, 'x'));
    await fs.mkdir(path.join(tmp, 'y'));
    const a = path.join(tmp, 'x', 'A.txt');
    const b = path.join(tmp, 'y', 'a.txt');
    await fs.writeFile(a, 'one');
    await fs.writeFile(b, 'two');
    const dir = await createProject(tmp, input([a, b]), now);
    const p = await loadProject(dir);
    expect(p.brief.sources).toEqual(['sources/upload/A.txt', 'sources/upload/a-2.txt']);
    expect(await fs.readFile(path.join(dir, 'sources/upload/A.txt'), 'utf8')).toBe('one');
    expect(await fs.readFile(path.join(dir, 'sources/upload/a-2.txt'), 'utf8')).toBe('two');
  });
});
