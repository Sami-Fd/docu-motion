import {describe, it, expect, beforeAll, afterAll, vi} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EXAMPLES} from '@docu-motion/scenes';
import type {Project} from '../../src/project/schema.js';
import {filmAssets, toFilmInput} from '../../src/render/toFilmInput.js';

let root: string;
let dir: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-film-input-'));
  dir = path.join(root, 'mon projet é');
  await fs.mkdir(path.join(dir, 'voice'), {recursive: true});
  await fs.writeFile(path.join(dir, 'voice', 'a.mp3'), 'x');
  await fs.writeFile(path.join(root, 'x.mp3'), 'x'); // exists, but outside the project
});
afterAll(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

const project = (audio?: string): Project => ({
  version: 1,
  brief: {
    topic: 't', language: 'en-GB', targetMinutes: 1, style: 'nuit',
    provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off',
  },
  sources: [],
  facts: [],
  scenes: [{
    id: 's0', narration: 'Hello.', spec: EXAMPLES.title, status: 'ok', durationFrames: 90,
    ...(audio === undefined ? {} : {audio: {path: audio, seconds: 2}}),
  }],
  voice: {engine: 'none'},
});

const audioOf = (audio: string) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const input = toFilmInput(project(audio), dir, null);
    return {audioPath: input.scenes[0]!.audioPath, warnings: warn.mock.calls.map((c) => String(c[0]))};
  } finally {
    warn.mockRestore();
  }
};

describe('toFilmInput', () => {
  it('maps style, language and scenes', () => {
    const input = toFilmInput(project(), dir, 'http://h/assets');
    expect(input).toEqual({
      style: 'nuit',
      language: 'en-GB',
      subtitles: true,
      assetBase: 'http://h/assets',
      scenes: [{id: 's0', narration: 'Hello.', spec: EXAMPLES.title, durationFrames: 90}],
    });
  });

  it.each(['voice/a.mp3', './voice/a.mp3', 'voice\\a.mp3', '.\\voice\\a.mp3'])(
    'normalises %j to a clean project-relative path',
    (raw) => {
      expect(audioOf(raw)).toEqual({audioPath: 'voice/a.mp3', warnings: []});
    },
  );

  it('converts an absolute path inside the project', () => {
    expect(audioOf(path.join(dir, 'voice', 'a.mp3')).audioPath).toBe('voice/a.mp3');
  });

  // Builders, not values: `root` only exists once beforeAll has run.
  it.each([
    ['a path escaping the project', () => '../x.mp3'],
    ['an absolute path outside the project', () => path.join(root, 'x.mp3')],
    ['a missing file', () => 'voice/nope.mp3'],
    ['a directory', () => 'voice'],
  ])('drops %s with a warning naming the scene', (_, raw) => {
    const {audioPath, warnings} = audioOf(raw());
    expect(audioPath).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Scene s0');
  });

  it('lists the referenced assets once each', () => {
    const p = project('./voice/a.mp3');
    p.scenes.push({...p.scenes[0]!, id: 's1', audio: {path: 'voice\\a.mp3', seconds: 2}});
    expect(filmAssets(toFilmInput(p, dir, null))).toEqual(['voice/a.mp3']);
  });
});
