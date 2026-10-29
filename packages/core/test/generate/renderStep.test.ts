import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {StepContext} from '../../src/generate/context.js';
import {renderStep} from '../../src/generate/steps/render.js';
import type {Project} from '../../src/project/schema.js';

const renderVideo = vi.hoisted(() => vi.fn(async () => '/x/video.mp4'));
vi.mock('../../src/render/render.js', () => ({renderVideo}));
vi.mock('../../src/render/probe.js', () => ({probeMedia: async () => ({durationSeconds: 2, hasAudio: true, width: 1, height: 1})}));

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'render-step-'));
  renderVideo.mockClear();
});
afterEach(() => fs.rm(dir, {recursive: true, force: true}));

const scene = (id: string, extra: Record<string, unknown> = {}) => ({id, durationFrames: 30, warnings: [], ...extra});
const ctx = () => ({projectDir: dir, onProgress: () => {}}) as unknown as StepContext;

describe('renderStep audio check', () => {
  it('throws before rendering when a scene audio file is missing', async () => {
    await fs.mkdir(path.join(dir, 'voice'));
    await fs.writeFile(path.join(dir, 'voice', 's01.wav'), 'x');
    const p = {
      scenes: [scene('s01', {audio: {path: 'voice/s01.wav', seconds: 1}}), scene('s02', {audio: {path: 'voice/s02.wav', seconds: 1}})],
    } as unknown as Project;
    await expect(renderStep(p, ctx())).rejects.toThrow('Audio for s02 is missing (voice/s02.wav) — run "rerender" to re-voice or record again');
    expect(renderVideo).not.toHaveBeenCalled();
  });

  it('renders when every audio file exists or no scene has audio', async () => {
    const p = {scenes: [scene('s01', {durationFrames: 60})]} as unknown as Project;
    await expect(renderStep(p, ctx())).resolves.toBe(p);
    expect(renderVideo).toHaveBeenCalledTimes(1);
  });
});
