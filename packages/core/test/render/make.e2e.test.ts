import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SCENE_TYPES} from '@docu-motion/scenes';
import {loadProject, probeMedia} from '../../src/index.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const runMake = (args: string[], env: Record<string, string> = {}): Promise<{code: number | null; stdout: string; stderr: string}> =>
  new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const quote = (s: string) => (win ? `"${s}"` : s);
    const child = spawn('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'scripts/make.ts', ...args.map(quote)], {
      shell: win,
      windowsHide: true,
      cwd: REPO,
      env: {...process.env, ...env},
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({code, stdout, stderr}));
  });

const okPath = (stdout: string) => /^OK (.+video\.mp4)\s*$/m.exec(stdout)?.[1];
const factsCalls = async (log: string) => (await fs.readFile(log, 'utf8')).split('\n').filter((l) => l.trim() === 'facts').length;

let data: string;
beforeAll(async () => {
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion données é-'));
  // no web search: with the fake provider the facts step runs from knowledge
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify({search: 'off'}), 'utf8');
});
afterAll(async () => {
  await fs.rm(data, {recursive: true, force: true});
});

const base = (topic: string) => [topic, '--provider', 'fake', '--data', data];
const projectDirs = async () => fs.readdir(path.join(data, 'projects')).catch(() => [] as string[]);

describe('make CLI', () => {
  it('generates a silent video', async () => {
    const r = await runMake(base('La dette publique française'));
    expect(r.stderr).toContain('[3/7] script');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/^Web search: off$/m);
    const mp4 = okPath(r.stdout);
    expect(mp4).toBeTruthy();
    const projectDir = path.dirname(path.dirname(mp4!));
    const p = await loadProject(projectDir);
    const info = await probeMedia(mp4!);
    expect(info.width).toBe(1920);
    expect(info.hasAudio).toBe(false);
    const expected = p.scenes.reduce((a, s) => a + s.durationFrames, 0) / 30;
    expect(Math.abs(info.durationSeconds - expected)).toBeLessThanOrEqual(0.2);
    expect(p.scenes).toHaveLength(11);
    expect(new Set(p.scenes.map((s) => s.spec.type))).toEqual(new Set(SCENE_TYPES));
    expect(p.progress.done).toHaveLength(7);
    // per-scene warning summary on stderr; knowledge-only facts are unverified, so every cited figure warns
    const warned = p.scenes.filter((s) => s.warnings.length > 0);
    expect(warned.length).toBeGreaterThan(0);
    expect(r.stderr).toContain(`Warnings in ${warned.length} of ${p.scenes.length} scenes:`);
    for (const s of warned) for (const w of s.warnings) expect(r.stderr).toContain(`  ${s.id}: ${w}`);
    expect(r.stderr).toContain(': Unverified figure: ');
  }, 600_000);

  it('resumes after a failed step without repeating finished work', async () => {
    const log = path.join(data, 'fake-calls.log');
    await fs.rm(log, {force: true});
    const failed = await runMake(base('Les retraites'), {DOCU_MOTION_FAIL_AT: 'scenes', DOCU_MOTION_FAKE_LOG: log});
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('FAILED at scenes');
    const hint = /Resume with: npm run make -- --resume "(.+)"/.exec(failed.stderr);
    expect(hint).toBeTruthy();
    const dir = hint![1]!;
    const before = await factsCalls(log);
    expect(before).toBe(1);
    const resumed = await runMake(['--resume', dir], {DOCU_MOTION_FAKE_LOG: log});
    expect(resumed.code, resumed.stderr).toBe(0);
    expect(okPath(resumed.stdout)).toBeTruthy();
    expect(await factsCalls(log)).toBe(before);
    expect((await loadProject(dir)).progress.done).toHaveLength(7);
  }, 600_000);

  it('checks the connection of the fake provider', async () => {
    const r = await runMake(['--check', '--provider', 'fake', '--data', data]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^OK fake \d+ms/m);
  }, 60_000);

  it('rejects an out-of-range length', async () => {
    const r = await runMake([...base('Sujet'), '--length', '30']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--length');
  }, 60_000);

  it('rejects a source that is neither a URL nor an existing file, creating no project', async () => {
    const before = await projectDirs();
    const r = await runMake([...base('Sujet'), '--sources', 'definitely-missing-notes.pdf']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Source not found: "definitely-missing-notes.pdf"');
    expect(await projectDirs()).toEqual(before);
  }, 60_000);

  it('fails on a missing API key before creating a project folder', async () => {
    const before = await projectDirs();
    const r = await runMake(['Sujet', '--provider', 'mistral', '--data', data], {MISTRAL_API_KEY: ''});
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('MISTRAL_API_KEY');
    expect(await projectDirs()).toEqual(before);
  }, 60_000);

  it('rejects an unknown style', async () => {
    const r = await runMake([...base('Sujet'), '--style', 'neon']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('neon');
  }, 60_000);
});
