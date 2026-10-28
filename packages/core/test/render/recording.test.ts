import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runRemotionTool, probeAudioSeconds} from '../../src/media/ffmpeg.js';
import {applyRecording, prepareRecording} from '../../src/voice/recording.js';
import {loadProject, saveProject} from '../../src/project/store.js';
import {exampleProject} from './exampleProject.js';
import {STALE_RECORDING_WARNING, voiceStep} from '../../src/generate/steps/voice.js';

let root: string;

/** N tones (lengths in s) separated by 2 s of silence. */
async function makeRecording(file: string, tones: number[], o: {lead?: number; tail?: number; gap?: number; volume?: number} = {}): Promise<void> {
  const inputs: string[] = [];
  const parts: string[] = [];
  let k = 0;
  const quiet = (d: number) => {
    inputs.push('-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=mono');
    parts.push(`[${k}:a]aresample=44100,aformat=channel_layouts=mono[a${k}]`);
    k++;
  };
  if (o.lead) quiet(o.lead);
  tones.forEach((d, i) => {
    if (i > 0) {
      inputs.push('-f', 'lavfi', '-t', String(o.gap ?? 2), '-i', 'anullsrc=r=44100:cl=mono');
      parts.push(`[${k}:a]aresample=44100,aformat=channel_layouts=mono[a${k}]`);
      k++;
    }
    inputs.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${d}`);
    parts.push(`[${k}:a]aresample=44100,aformat=channel_layouts=mono${o.volume ? `,volume=${o.volume}` : ''}[a${k}]`);
    k++;
  });
  if (o.tail) quiet(o.tail);
  const labels = Array.from({length: k}, (_, i) => `[a${i}]`).join('');
  await runRemotionTool('ffmpeg', [
    '-y',
    ...inputs,
    '-filter_complex',
    `${parts.join(';')};${labels}concat=n=${k}:v=0:a=1[out]`,
    '-map',
    '[out]',
    file,
  ]);
}

async function project(name: string, n: number, extra: (p: ReturnType<typeof exampleProject>) => void = () => {}) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, {recursive: true});
  const p = exampleProject('papier');
  p.scenes = p.scenes.slice(0, n).map((s, i) => ({...s, id: `s${i + 1}`}));
  p.voice = {engine: 'edge'};
  p.progress = {done: ['sources', 'facts', 'script', 'scenes', 'voice', 'layout', 'render', 'package']};
  extra(p);
  await saveProject(dir, p);
  return dir;
}

let three: string;
let two: string;
let threeMp3: string;
let padded: string;
let longPause: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-'));
  three = path.join(root, 'three.wav');
  two = path.join(root, 'two.wav');
  threeMp3 = path.join(root, 'three.mp3');
  await makeRecording(three, [2, 3, 2]);
  await makeRecording(two, [2, 8]);
  await makeRecording(threeMp3, [2, 3, 2]);
  padded = path.join(root, 'padded.wav');
  await makeRecording(padded, [2, 3, 2], {lead: 3, tail: 4});
  longPause = path.join(root, 'long.wav');
  await makeRecording(longPause, [2, 2], {gap: 1.5});
}, 90_000);

afterAll(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

describe('prepareRecording', () => {
  it('writes the narrations joined by 2 s breaks, without titles', async () => {
    const dir = await project('prep', 3);
    const file = await prepareRecording(dir);
    expect(file).toBe(path.join(dir, 'out', 'recording-script.txt'));
    const text = await fs.readFile(file, 'utf8');
    expect(text.match(/<break time="2\.0s" \/>/g)).toHaveLength(2);
    const p = await loadProject(dir);
    expect(text).toBe(p.scenes.map((s) => s.narration).join('\n<break time="2.0s" />\n'));
  });
});

describe('applyRecording', () => {
  it('splits a matching recording into one wav per scene', async () => {
    const dir = await project('ok', 3, (p) => {
      p.scenes[0]!.dirty = true;
      p.scenes[0]!.warnings = [STALE_RECORDING_WARNING, 'keep me'];
    });
    await fs.mkdir(path.join(dir, 'voice'));
    await fs.writeFile(path.join(dir, 'voice', 's1.mp3'), 'old');
    const r = await applyRecording(dir, three);
    expect(r.ok).toBe(true);
    const p = await loadProject(dir);
    expect(p.voice.engine).toBe('upload');
    const expected = [2.3, 3.6, 2.3];
    for (const [i, s] of p.scenes.entries()) {
      expect(s.audio!.hash).toBe('upload');
      expect(s.audio!.path).toBe(`voice/${s.id}.wav`);
      const sec = await probeAudioSeconds(path.join(dir, s.audio!.path));
      expect(sec).toBeGreaterThan(expected[i]! - 0.15);
      expect(sec).toBeLessThan(expected[i]! + 0.15);
      expect(s.audio!.seconds).toBeCloseTo(sec, 1);
      expect(s.dirty).toBeUndefined();
    }
    expect(p.scenes[0]!.warnings).toEqual(['keep me']);
    expect(p.progress.done).not.toContain('voice');
    expect(p.progress.done).not.toContain('render');
    expect(p.progress.done).not.toContain('package');
    expect(p.progress.done).toContain('layout');
    await expect(fs.stat(path.join(dir, 'voice', 'recording.wav'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, 'voice', 's1.mp3'))).rejects.toThrow();
    const left = await fs.readdir(path.join(dir, 'voice'));
    expect(left.filter((f) => f.includes('tmp'))).toEqual([]);
  }, 60_000);

  it('trims dead air: lead-in, tail and a pad around each pause', async () => {
    const dir = await project('trim', 3);
    expect((await applyRecording(dir, padded)).ok).toBe(true);
    const p = await loadProject(dir);
    [2.6, 3.6, 2.6].forEach((e, i) => expect(p.scenes[i]!.audio!.seconds).toBeGreaterThan(e - 0.15));
    [2.6, 3.6, 2.6].forEach((e, i) => expect(p.scenes[i]!.audio!.seconds).toBeLessThan(e + 0.15));
  }, 60_000);

  it('splits a one-scene project despite a pause inside it', async () => {
    const dir = await project('one', 1);
    const r = await applyRecording(dir, longPause);
    expect(r.ok).toBe(true);
    const p = await loadProject(dir);
    expect(p.scenes[0]!.audio!.seconds).toBeGreaterThan(5.4);
  }, 60_000);

  it('suggests cuts and hints when the pause count is wrong', async () => {
    const dir = await project('sug', 2);
    const r = await applyRecording(dir, three);
    expect(r).toMatchObject({ok: false, found: 2, needed: 1});
    if (!r.ok) expect(r.suggested).toHaveLength(1);
    const dir3 = await project('sug3', 3);
    const r0 = await applyRecording(dir3, two, {minSilence: 5});
    expect(r0).toMatchObject({ok: false, found: 0, needed: 2, suggested: []});
    if (!r0.ok) expect(r0.hint).toMatch(/-38 dB|noise/i);
  }, 60_000);

  it('cleans leftovers of an earlier crash', async () => {
    const dir = await project('left', 3);
    await fs.mkdir(path.join(dir, 'voice'));
    await fs.writeFile(path.join(dir, 'voice', 's1.tmp.wav'), 'x');
    await fs.writeFile(path.join(dir, 'voice', 'recording.tmp.wav'), 'x');
    await fs.writeFile(path.join(dir, 'voice', 's1.wav.bak'), 'x');
    expect((await applyRecording(dir, three)).ok).toBe(true);
    expect((await fs.readdir(path.join(dir, 'voice'))).sort()).toEqual(['recording.wav', 's1.wav', 's2.wav', 's3.wav']);
  }, 60_000);

  it('fails cleanly in the middle of the cuts', async () => {
    const dir = await project('mid', 3);
    expect((await applyRecording(dir, three)).ok).toBe(true);
    const snap = async () => Object.fromEntries(await Promise.all(
      ['project.json', 'voice/s1.wav', 'voice/s2.wav', 'voice/s3.wav', 'voice/recording.wav'].map(async (f) => [f, (await fs.readFile(path.join(dir, f))).toString('base64')]),
    ));
    const before = await snap();
    await fs.mkdir(path.join(dir, 'voice', 's2.tmp.wav'));
    await expect(applyRecording(dir, padded)).rejects.toThrow();
    expect(await snap()).toEqual(before);
    await expect(fs.stat(path.join(dir, 'voice', 's1.tmp.wav'))).rejects.toThrow();
    await expect(fs.stat(path.join(dir, 'voice', 'recording.tmp.wav'))).rejects.toThrow();
  }, 90_000);

  it('trims the lead-in and tail of an mp3 (header duration is only an estimate)', async () => {
    const mp3 = path.join(root, 'padded.mp3');
    await makeRecording(mp3, [2, 3, 2], {lead: 3, tail: 4});
    const dir = await project('mp3tail', 3);
    expect((await applyRecording(dir, mp3)).ok).toBe(true);
    const p = await loadProject(dir);
    [2.6, 3.6, 2.6].forEach((e, i) => {
      expect(p.scenes[i]!.audio!.seconds).toBeGreaterThan(e - 0.2);
      expect(p.scenes[i]!.audio!.seconds).toBeLessThan(e + 0.2);
    });
  }, 60_000);

  it('restores an orphaned .bak left by a crash, even if the apply then fails', async () => {
    const dir = await project('bakrestore', 3);
    await fs.mkdir(path.join(dir, 'voice'));
    await fs.writeFile(path.join(dir, 'voice', 's1.wav.bak'), 'keep');
    await fs.mkdir(path.join(dir, 'voice', 's2.tmp.wav'));
    await expect(applyRecording(dir, three)).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, 'voice', 's1.wav'), 'utf8')).toBe('keep');
  }, 60_000);

  it('explains a too-quiet recording and accepts it with a lower threshold', async () => {
    const quiet = path.join(root, 'quiet.wav');
    await makeRecording(quiet, [2, 3, 2], {volume: 0.1});
    const dir = await project('quiet', 3);
    await expect(applyRecording(dir, quiet)).rejects.toThrow(/silent or quieter than -38 dB.*noiseDb/);
    expect((await applyRecording(dir, quiet, {noiseDb: -50})).ok).toBe(true);
  }, 60_000);

  it('accepts an mp3 recording', async () => {
    const dir = await project('mp3', 3);
    const r = await applyRecording(dir, threeMp3);
    expect(r.ok).toBe(true);
    await expect(fs.stat(path.join(dir, 'voice', 'recording.mp3'))).resolves.toBeTruthy();
  }, 60_000);

  it('reports a wrong pause count and changes nothing', async () => {
    const dir = await project('bad', 3);
    const before = await fs.readFile(path.join(dir, 'project.json'));
    const r = await applyRecording(dir, two);
    expect(r).toMatchObject({ok: false, found: 1, needed: 2});
    if (!r.ok) expect(r.silences).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, 'project.json'))).toEqual(before);
    await expect(fs.stat(path.join(dir, 'voice'))).rejects.toThrow();
  }, 60_000);

  it('accepts explicit cuts', async () => {
    const dir = await project('cuts', 3);
    const r = await applyRecording(dir, two, {cuts: [2.5, 3.0]});
    expect(r.ok).toBe(true);
    const p = await loadProject(dir);
    expect(p.scenes[1]!.audio!.seconds).toBeCloseTo(0.5, 1);
  }, 60_000);

  it('throws on non-increasing or out-of-range cuts', async () => {
    const dir = await project('badcuts', 3);
    await expect(applyRecording(dir, two, {cuts: [3, 2]})).rejects.toThrow(/increasing/);
    await expect(applyRecording(dir, two, {cuts: [2, 99]})).rejects.toThrow(/duration/);
    await expect(applyRecording(dir, two, {cuts: [2]})).rejects.toThrow(/2 cut/);
  }, 60_000);

  it('keeps the previous recording and project when the run fails midway', async () => {
    const dir = await project('atomic', 3);
    expect((await applyRecording(dir, three)).ok).toBe(true);
    const before = await fs.readFile(path.join(dir, 'project.json'));
    const wav = await fs.readFile(path.join(dir, 'voice', 's2.wav'));
    const rec = await fs.readFile(path.join(dir, 'voice', 'recording.wav'));
    const ac = new AbortController();
    ac.abort();
    await expect(applyRecording(dir, two, {cuts: [2.5, 3.0], signal: ac.signal})).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, 'project.json'))).toEqual(before);
    expect(await fs.readFile(path.join(dir, 'voice', 's2.wav'))).toEqual(wav);
    expect(await fs.readFile(path.join(dir, 'voice', 'recording.wav'))).toEqual(rec);
    const left = await fs.readdir(path.join(dir, 'voice'));
    expect(left.filter((f) => f.includes('tmp'))).toEqual([]);
  }, 90_000);

  it('gives a clear error for a file without audio', async () => {
    const dir = await project('noaudio', 3);
    // A 1x1 PNG: a decodable file with a video stream and no audio.
    const f = path.join(root, 'image.png');
    await fs.writeFile(
      f,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
    );
    await expect(applyRecording(dir, f)).rejects.toThrow(/no audio/i);
  }, 60_000);

  it('keeps the recording when a narration is edited afterwards (dirty path)', async () => {
    const dir = await project('prec', 3);
    await applyRecording(dir, three);
    const p = await loadProject(dir);
    p.scenes[1] = {...p.scenes[1]!, narration: 'Autre texte.', dirty: true};
    const out = await voiceStep()(p, {projectDir: dir, settings: {keys: {}}, onProgress() {}} as never);
    expect(out.scenes[1]!.audio!.hash).toBe('upload');
    expect(out.scenes[1]!.warnings).toContain(STALE_RECORDING_WARNING);
  }, 60_000);
});
