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
    expect(STEP_NAMES).toEqual(['sources', 'facts', 'script', 'scenes', 'voice', 'layout', 'render']);
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
