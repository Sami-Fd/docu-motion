import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EXAMPLES} from '@docu-motion/scenes';
import {createFakeTtsEngine, probeMedia, saveProject, type Project} from '../../src/index.js';
import type {StepContext} from '../../src/generate/context.js';
import {runRemotionTool} from '../../src/media/ffmpeg.js';
import {voiceStep} from '../../src/generate/steps/voice.js';
import {invalidateBundle} from '../../src/render/bundle.js';
import {renderVideo} from '../../src/render/render.js';

const words = (n: number, w = 'mot') => Array.from({length: n}, () => w).join(' ');
const project = (): Project => ({
  version: 1,
  brief: {topic: 'T', language: 'fr', targetMinutes: 1, style: 'papier', provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off', sources: []},
  sources: [],
  facts: [],
  scenes: [
    {id: 's01', narration: words(5), spec: EXAMPLES.title, status: 'ok', durationFrames: 60, factIds: [], warnings: []},
    {id: 's02', narration: words(5), spec: EXAMPLES.bars, status: 'ok', durationFrames: 60, factIds: [], warnings: []},
  ],
  voice: {engine: 'edge', voiceId: 'fake'},
  progress: {done: []},
});

let root: string;
let dir: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-voice-'));
  dir = path.join(root, 'mon projet é');
  await fs.mkdir(dir, {recursive: true});
});
afterAll(async () => {
  invalidateBundle(dir);
  await fs.rm(root, {recursive: true, force: true});
});

const sum = (p: Project) => p.scenes.reduce((a, s) => a + s.durationFrames, 0) / 30;

describe('voice step with fake TTS', () => {
  it('voices, renders audio, and re-voices only an edited scene into the video', async () => {
    const step = voiceStep({engine: createFakeTtsEngine()});
    const c = {projectDir: dir, settings: {keys: {}}, onProgress: () => {}} as unknown as StepContext;
    let p = await step(project(), c);
    await saveProject(dir, p);
    const info = await probeMedia(await renderVideo(dir, p));
    expect(info.hasAudio).toBe(true);
    expect(Math.abs(info.durationSeconds - sum(p))).toBeLessThanOrEqual(0.2);

    const s0 = await fs.readFile(path.join(dir, 'voice', 's01.mp3'));
    const m0 = (await fs.stat(path.join(dir, 'voice', 's01.mp3'))).mtimeMs;
    p = {...p, scenes: p.scenes.map((s, i) => (i === 1 ? {...s, narration: words(15, 'plus')} : s))};
    const p2 = await step(p, c);
    expect(Buffer.compare(s0, await fs.readFile(path.join(dir, 'voice', 's01.mp3')))).toBe(0);
    expect((await fs.stat(path.join(dir, 'voice', 's01.mp3'))).mtimeMs).toBe(m0);
    expect(sum(p2)).toBeGreaterThan(sum(p));
    const mp4 = await renderVideo(dir, p2);
    const info2 = await probeMedia(mp4);
    expect(info2.durationSeconds).toBeGreaterThan(info.durationSeconds + 2);
    expect(Math.abs(info2.durationSeconds - sum(p2))).toBeLessThanOrEqual(0.2);
    // A stale bundle would play the old 2 s s02 tone, then silence: no gap of 1.5 s or more may exist (padding is 1.2 s).
    const {stderr} = await runRemotionTool('ffmpeg', ['-hide_banner', '-i', mp4, '-vn', '-af', 'silencedetect=n=-38dB:d=1.5', '-f', 'null', '-']);
    expect(stderr).not.toContain('silence_start');
  }, 400_000);
});
