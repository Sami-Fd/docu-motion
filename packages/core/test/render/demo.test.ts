import {describe, it, expect} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {estimateDurationFrames} from '@docu-motion/scenes';
import {loadProject} from '../../src/index.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const DEMO = path.join(REPO, 'examples', 'secu');

const runScript = (args: string[]): Promise<{code: number | null; stdout: string; stderr: string}> =>
  new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const quote = (s: string) => (win ? `"${s}"` : s);
    const child = spawn(
      'npx',
      ['tsx', '--tsconfig', 'tsconfig.base.json', 'scripts/render-project.ts', ...args.map(quote)],
      {shell: win, windowsHide: true, cwd: REPO},
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({code, stdout, stderr}));
  });

describe('demo project', () => {
  it('demo project validates', async () => {
    const p = await loadProject(DEMO);
    expect(p.scenes).toHaveLength(10);
    expect(new Set(p.scenes.map((s) => s.spec.type)).size).toBe(9);
    expect(p.voice.engine).toBe('none');
    for (const s of p.scenes) expect(s.durationFrames).toBe(estimateDurationFrames(s.narration));
  });
});

describe('render script', () => {
  it('render script reports bad input', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion bad é-'));
    try {
      await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({version: 2}), 'utf8');
      const r = await runScript([dir]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('version');
    } finally {
      await fs.rm(dir, {recursive: true, force: true});
    }
  }, 60_000);

  it('rejects an unknown style', async () => {
    const r = await runScript([DEMO, '--style', 'neon']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('neon');
  }, 60_000);
});
