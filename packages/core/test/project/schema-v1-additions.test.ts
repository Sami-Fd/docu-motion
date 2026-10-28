import {describe, it, expect} from 'vitest';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import {loadProject, saveProject} from '../../src/project/store.js';
import {STEP_NAMES} from '../../src/project/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('Plan 1 compatibility', () => {
  it('loads a Plan 1 project', async () => {
    const p = await loadProject(path.join(root, 'examples/how-it-works'));
    expect(p.progress.done).toEqual([]);
    expect(p.brief.sources).toEqual([]);
    expect(p.scenes.length).toBeGreaterThan(0);
    for (const s of p.scenes) {
      expect(s.factIds).toEqual([]);
      expect(s.warnings).toEqual([]);
    }
  });
  it('lists the steps in order', () => {
    expect(STEP_NAMES).toEqual(['sources', 'facts', 'script', 'scenes', 'voice', 'layout', 'render', 'package']);
  });
  it('round-trips a defaulted Plan 1 project', async () => {
    const p = await loadProject(path.join(root, 'examples/how-it-works'));
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rt é-'));
    try {
      await saveProject(tmp, p);
      expect(await loadProject(tmp)).toEqual(p);
    } finally {
      await fs.rm(tmp, {recursive: true, force: true});
    }
  });
});

describe('Plan 3 thumbnail and youtube shapes', () => {
  const load = async (extra: Record<string, unknown>) => {
    const raw = JSON.parse(await fs.readFile(path.join(root, 'examples/how-it-works/project.json'), 'utf8'));
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'compat é-'));
    try {
      await fs.writeFile(path.join(tmp, 'project.json'), JSON.stringify({...raw, ...extra}), 'utf8');
      return await loadProject(tmp);
    } finally {
      await fs.rm(tmp, {recursive: true, force: true});
    }
  };
  it('loads the old thumbnail {spec} shape as no thumbnail', async () => {
    const p = await load({thumbnail: {spec: {anything: 1}}});
    expect(p.thumbnail).toBeUndefined();
  });
  it('keeps the new thumbnail shape and defaults youtube warnings', async () => {
    const spec = {words: ['A', 'B'], characters: 1, element: 'none', highlight: 0};
    const p = await load({
      thumbnail: {options: [spec], chosen: 0, file: 'out/thumbnail.png'},
      youtube: {titles: ['a'], description: 'd', chapters: [], hashtags: []},
    });
    expect(p.thumbnail).toEqual({options: [spec], chosen: 0, file: 'out/thumbnail.png'});
    expect(p.youtube!.warnings).toEqual([]);
  });
});
