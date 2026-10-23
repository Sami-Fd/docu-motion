import {describe, it, expect, beforeAll, afterAll, vi} from 'vitest';
import {promises as fs, readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {EXAMPLES, durationFromAudio} from '@docu-motion/scenes';
import {saveProject, loadProject, type Project} from '../../src/index.js';
import {renderSceneStill, renderVideo} from '../../src/render/render.js';
import {probeMedia} from '../../src/render/probe.js';

const TONE = fileURLToPath(new URL('../fixtures/tone.mp3', import.meta.url));
const NARRATION = 'La Sécu paie les dépenses de maladie, de retraites et de famille.';

const baseProject = (): Project => ({
  version: 1,
  brief: {
    topic: 'Sécu',
    language: 'fr',
    targetMinutes: 1,
    style: 'papier',
    provider: {kind: 'fake', provider: 'fake'},
    webSearch: 'off',
  },
  sources: [],
  facts: [],
  scenes: [
    {id: 's0', narration: NARRATION, spec: EXAMPLES.title, status: 'ok', durationFrames: 60},
    {id: 's1', narration: NARRATION, spec: EXAMPLES.bars, status: 'ok', durationFrames: 60},
  ],
  voice: {engine: 'none'},
});

let root: string;
const freshDir = async (name: string): Promise<string> => {
  const dir = path.join(root, name, 'mon projet é');
  await fs.mkdir(dir, {recursive: true});
  return dir;
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-render-'));
});
afterAll(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

describe('render', () => {
  it('renders a still per scene', async () => {
    const dir = await freshDir('stills');
    const p = baseProject();
    await saveProject(dir, p);
    const loaded = await loadProject(dir);
    for (let i = 0; i < loaded.scenes.length; i++) {
      const file = await renderSceneStill(dir, loaded, i);
      expect(file).toBe(path.join(dir, 'out', 'stills', `${loaded.scenes[i]!.id}.png`));
      const png = PNG.sync.read(readFileSync(file));
      expect([png.width, png.height]).toEqual([1920, 1080]);
    }
  }, 180_000);

  it('renders a video with audio', async () => {
    const dir = await freshDir('video');
    await fs.mkdir(path.join(dir, 'voice'), {recursive: true});
    await fs.copyFile(TONE, path.join(dir, 'voice', 's0.mp3'));
    const p = baseProject();
    p.scenes[0]!.audio = {path: 'voice/s0.mp3', seconds: 2};
    p.scenes[0]!.durationFrames = durationFromAudio(2);
    const file = await renderVideo(dir, p);
    expect(file).toBe(path.join(dir, 'out', 'video.mp4'));
    const info = await probeMedia(file);
    expect(info.hasAudio).toBe(true);
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(Math.abs(info.durationSeconds - (durationFromAudio(2) + 60) / 30)).toBeLessThan(0.1);
  }, 180_000);

  it('missing audio is silent, not fatal', async () => {
    const dir = await freshDir('missing');
    const p = baseProject();
    p.scenes[0]!.audio = {path: 'voice/nope.mp3', seconds: 2};
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const file = await renderVideo(dir, p);
      const info = await probeMedia(file);
      expect(info.hasAudio).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('s0'));
    } finally {
      warn.mockRestore();
    }
  }, 180_000);

  it('cancels', async () => {
    const dir = await freshDir('cancel');
    const p = baseProject();
    p.scenes.forEach((s) => (s.durationFrames = 300));
    const ac = new AbortController();
    const run = renderVideo(dir, p, {signal: ac.signal, onProgress: () => ac.abort()});
    await expect(run).rejects.toThrow(/cancel/i);
  }, 180_000);
});
