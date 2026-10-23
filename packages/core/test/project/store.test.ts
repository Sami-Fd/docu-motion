import {describe, it, expect, beforeEach} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadProject, saveProject, ProjectLoadError} from '../../src/project/store.js';
import type {Project} from '../../src/project/schema.js';

function makeProject(topic = 'Retraites'): Project {
  return {
    version: 1,
    brief: {
      topic,
      language: 'fr',
      targetMinutes: 3,
      style: 'papier',
      provider: {kind: 'fake', provider: 'fake'},
      webSearch: 'off',
    },
    sources: [],
    facts: [],
    scenes: [
      {
        id: 's1',
        narration: 'Bonjour',
        spec: {type: 'title', title: 'Hello'},
        status: 'ok',
        durationFrames: 120,
      },
    ],
    voice: {engine: 'none'},
  };
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docu mötion '));
});

const file = () => path.join(dir, 'project.json');

describe('project store', () => {
  it('round-trips a valid project', async () => {
    const p = makeProject();
    await saveProject(dir, p);
    expect(await loadProject(dir)).toEqual(p);
  });

  it('keeps a backup', async () => {
    const a = makeProject('A');
    const b = makeProject('B');
    await saveProject(dir, a);
    await saveProject(dir, b);
    const bak = JSON.parse(await fs.readFile(file() + '.bak', 'utf8'));
    expect(bak).toEqual(a);
    expect((await loadProject(dir)).brief.topic).toBe('B');
  });

  it('rejects wrong version', async () => {
    await fs.writeFile(file(), JSON.stringify({...makeProject(), version: 2}));
    const err = await loadProject(dir).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectLoadError);
    expect(err.issues.some((i: {path: string}) => i.path === 'version')).toBe(true);
  });

  it('names the bad field', async () => {
    const p: any = makeProject();
    p.scenes[0].durationFrames = 'x';
    await fs.writeFile(file(), JSON.stringify(p));
    const err = await loadProject(dir).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectLoadError);
    expect(err.issues.some((i: {path: string}) => i.path === 'scenes.0.durationFrames')).toBe(true);
    expect(err.message).toContain(file());
  });

  it('does not touch an invalid file', async () => {
    const bytes = JSON.stringify({...makeProject(), version: 2});
    await fs.writeFile(file(), bytes);
    await loadProject(dir).catch(() => undefined);
    expect(await fs.readFile(file(), 'utf8')).toBe(bytes);
    await expect(fs.access(file() + '.bak')).rejects.toThrow();
  });
});
