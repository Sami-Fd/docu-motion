import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadProject, probeMedia} from '../../src/index.js';
import {runRemotionTool} from '../../src/media/ffmpeg.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const run = (script: string, args: string[], env: Record<string, string> = {}): Promise<{code: number | null; stdout: string; stderr: string}> =>
  new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const quote = (s: string) => (win ? `"${s}"` : s);
    const child = spawn('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', `scripts/${script}.ts`, ...args.map(quote)], {
      shell: win,
      windowsHide: true,
      cwd: REPO,
      env: {...process.env, DOCU_MOTION_FAKE_TTS: '1', ...env},
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({code, stdout, stderr}));
  });

/** `count` 1.5 s tones separated by 2 s of digital silence. */
async function makeTones(file: string, count: number): Promise<void> {
  const inputs: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) inputs.push('-f', 'lavfi', '-t', '2', '-i', 'anullsrc=r=44100:cl=mono');
    inputs.push('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5:sample_rate=44100');
  }
  const total = 2 * count - 1;
  for (let i = 0; i < total; i++) labels.push(`[${i}:a]aformat=channel_layouts=mono[a${i}]`);
  await runRemotionTool('ffmpeg', [
    '-y',
    ...inputs,
    '-filter_complex',
    `${labels.join(';')};${labels.map((_, i) => `[a${i}]`).join('')}concat=n=${total}:v=0:a=1[out]`,
    '-map',
    '[out]',
    file,
  ]);
}

let data: string;
let dir: string;
let mp4: string;
const touch = (...args: string[]) => run('touch', [dir, ...args]);
const mtime = async (f: string) => (await fs.stat(path.join(dir, f))).mtimeMs;

beforeAll(async () => {
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion données é-'));
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify({search: 'off'}), 'utf8');
});
afterAll(async () => {
  await fs.rm(data, {recursive: true, force: true});
});

describe('make with the default voice, then touch', () => {
  it('make produces audio, a thumbnail and a YouTube kit', async () => {
    const r = await run('make', ['La dette publique française', '--provider', 'fake', '--data', data]);
    expect(r.code, r.stderr).toBe(0);
    mp4 = /^OK (.+video\.mp4)\s*$/m.exec(r.stdout)![1]!;
    dir = path.dirname(path.dirname(mp4));
    expect((await probeMedia(mp4)).hasAudio).toBe(true);
    const out = await fs.readdir(path.join(dir, 'out'));
    expect(out.some((f) => /^thumbnail\.(png|jpg)$/.test(f))).toBe(true);
    const yt = await fs.readFile(path.join(dir, 'out', 'youtube.txt'), 'utf8');
    expect(yt).toContain('0:00');
    expect(r.stdout).toMatch(/thumbnail\.(png|jpg)/);
    expect(r.stdout).toContain('youtube.txt');
  }, 900_000);

  it('edit then rerender re-voices only that scene', async () => {
    const before = await probeMedia(mp4);
    const p0 = await loadProject(dir);
    const mp3s = (await fs.readdir(path.join(dir, 'voice'))).filter((f) => f.endsWith('.mp3'));
    expect(mp3s).toHaveLength(p0.scenes.length);
    const mt0 = Object.fromEntries(await Promise.all(mp3s.map(async (f) => [f, await mtime(`voice/${f}`)] as const)));
    await new Promise((r) => setTimeout(r, 1100));
    const words = Array.from({length: 35}, (_, i) => `mot${i}`).join(' ');
    const e = await touch('edit', 's02', words);
    expect(e.code, e.stderr).toBe(0);
    expect(e.stdout).toContain('OK s02');
    const r = await touch('rerender');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/OK .+video\.mp4/);
    for (const f of mp3s) {
      const now = await mtime(`voice/${f}`);
      if (f === 's02.mp3') expect(now).toBeGreaterThan(mt0[f]!);
      else expect(now, f).toBe(mt0[f]);
    }
    const p1 = await loadProject(dir);
    expect(p1.scenes[1]!.audio!.seconds).toBeCloseTo(35 / 2.5, 0);
    const delta = (p1.scenes[1]!.durationFrames - p0.scenes[1]!.durationFrames) / 30;
    const after = await probeMedia(mp4);
    expect(Math.abs(after.durationSeconds - before.durationSeconds - delta)).toBeLessThanOrEqual(0.1);
  }, 900_000);

  it('records, splits and re-renders an uploaded voice', async () => {
    const p = await loadProject(dir);
    const n = p.scenes.length;
    const pr = await touch('prepare-recording');
    expect(pr.code, pr.stderr).toBe(0);
    expect(await fs.readFile(path.join(dir, 'out', 'recording-script.txt'), 'utf8')).toContain('<break time="2.0s" />');

    const wav = path.join(data, 'rec.wav');
    await makeTones(wav, n);
    const rec = await touch('recording', wav);
    expect(rec.code, rec.stderr).toBe(0);
    expect(rec.stdout).toContain('OK');
    const rr = await touch('rerender');
    expect(rr.code, rr.stderr).toBe(0);
    const q = await loadProject(dir);
    expect(q.voice.engine).toBe('upload');
    const info = await probeMedia(mp4);
    expect(info.hasAudio).toBe(true);
    const expected = q.scenes.reduce((a, s) => a + s.durationFrames, 0) / 30;
    expect(Math.abs(info.durationSeconds - expected)).toBeLessThanOrEqual(0.3);
    // n tones of 1.5 s, each scene padded by 1.2 s, plus a little kept silence
    expect(info.durationSeconds).toBeGreaterThan(n * 2.7 - 0.5);
    expect(info.durationSeconds).toBeLessThan(n * 2.7 + n * 1.2);
  }, 900_000);

  it('reports a pause mismatch with the numbers and exits 1', async () => {
    const wav = path.join(data, 'one.wav');
    await runRemotionTool('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', wav]);
    const r = await touch('recording', wav);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Found 0 pauses, need \d+\./);
    expect(r.stderr).toContain('Pass --cuts with');
  }, 120_000);

  it('suggests --cuts when there is one pause too many', async () => {
    const n = (await loadProject(dir)).scenes.length;
    const wav = path.join(data, 'many.wav');
    await makeTones(wav, n + 1);
    const r = await touch('recording', wav);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`Found ${n} pauses, need ${n - 1}.`);
    const m = /^Try: --cuts (.+)$/m.exec(r.stderr);
    expect(m?.[1]?.split(',')).toHaveLength(n - 1);
  }, 120_000);

  it('rejects a thumbnail that does not exist', async () => {
    const r = await touch('thumbnail', '9');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Thumbnail 9 does not exist (choose 1..3)');
  }, 120_000);

  it('refresh-youtube clears the copy', async () => {
    const r = await touch('refresh-youtube', '--thumbnails');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('rerender');
    const p = await loadProject(dir);
    expect(p.thumbnail).toBeUndefined();
    expect(p.youtube?.hook).toBeTruthy();
  }, 120_000);

  it('prints usage for an unknown command or missing arguments', async () => {
    for (const args of [['frobnicate'], ['edit', 's01'], ['regenerate'], []]) {
      const r = await touch(...args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stderr).toContain('Usage: npm run touch');
    }
  }, 120_000);

  it('validates recording options', async () => {
    const wav = path.join(data, 'one.wav');
    const a = await touch('recording', wav, '--noise', '38');
    expect(a.code).toBe(1);
    expect(a.stderr).toContain('negative');
    const b = await touch('recording', wav, '--min-silence', '0');
    expect(b.code).toBe(1);
    expect(b.stderr).toContain('--min-silence');
  }, 120_000);

  it('sets the voice, accepts -- before text starting with --, and lowercases scene ids', async () => {
    const e = await touch('edit', 'S01', '--', '--5 % de dette');
    expect(e.code, e.stderr).toBe(0);
    expect((await loadProject(dir)).scenes[0]!.narration).toBe('--5 % de dette');
    const bad = await touch('voice', 'edge', '--voice-id', '');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('--voice-id is empty');
    const unknown = await touch('voice', 'robot');
    expect(unknown.code).toBe(1);
    const v = await touch('voice', 'edge', '--voice-id', 'fr-FR-HenriNeural');
    expect(v.code, v.stderr).toBe(0);
    expect(v.stdout).toContain('rerender');
    const p = await loadProject(dir);
    expect(p.voice).toEqual({engine: 'edge', voiceId: 'fr-FR-HenriNeural'});
    expect(p.progress.done).not.toContain('voice');
  }, 120_000);

  it('names the path that was tried when the project folder is wrong', async () => {
    const r = await run('touch', [path.join(data, 'nope'), 'rerender']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(path.join(data, 'nope'));
  }, 120_000);

  it('rejects an unknown scene id', async () => {
    const r = await touch('edit', 's99', 'texte');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Unknown scene "s99"');
  }, 120_000);
});
