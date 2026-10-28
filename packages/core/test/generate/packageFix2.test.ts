import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {StepContext} from '../../src/generate/context.js';
import {applyThumbnailChoice, JPEG_STILL_BIG_WARNING, JPEG_WARNING, packageStep} from '../../src/generate/steps/package.js';
import {demoResponder} from '../../src/llm/demoResponder.js';
import type {Project} from '../../src/project/schema.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'package-fix2-'));
});
afterEach(() => fs.rm(dir, {recursive: true, force: true}));

const llm = {
  name: 'fake',
  capabilities: {nativeWebSearch: false, vision: false},
  generateObject: async ({schema, system, prompt}: {schema: never; system: string; prompt: string}) => demoResponder({schema, system, prompt}),
  generateText: async () => '',
};
const ctx = (): StepContext => ({projectDir: dir, llm, settings: {keys: {}}, onProgress: () => {}}) as unknown as StepContext;
const project = (): Project =>
  ({
    version: 1,
    brief: {topic: 'Les retraites', language: 'fr', style: 'papier'},
    sources: [],
    facts: [],
    scenes: [1, 2, 3].map((i) => ({
      id: `s${i}`,
      narration: `Scène ${i}.`,
      spec: {type: 'title', title: `Titre ${i}`, decor: 'none', characters: 0},
      status: 'ok',
      durationFrames: 360,
      factIds: [],
      warnings: [],
    })),
    voice: {engine: 'none'},
    progress: {done: []},
  }) as unknown as Project;
const render = (bytes: (out: string) => number) =>
  vi.fn(async (_d: string, _p: Project, _s: unknown, out: string) => {
    await fs.mkdir(path.dirname(out), {recursive: true});
    await fs.writeFile(out, Buffer.alloc(bytes(out), 1));
    return out;
  });
const exists = (f: string) => fs.stat(path.join(dir, f)).then(() => true, () => false);

describe('package fix round 2', () => {
  it('re-renders freshly generated options even when stale option files exist', async () => {
    await fs.mkdir(path.join(dir, 'out'), {recursive: true});
    await fs.writeFile(path.join(dir, 'out', 'thumbnail-1.png'), 'stale');
    const r = render(() => 1000);
    await packageStep({renderThumbnail: r})(project(), ctx());
    expect(r).toHaveBeenCalledTimes(3);
    expect((await fs.readFile(path.join(dir, 'out', 'thumbnail-1.png'))).length).toBe(1000);
  });

  it('keeps the still-too-big warning from the JPEG fallback', async () => {
    const r = render(() => 3_000_000);
    const p = await packageStep({renderThumbnail: r})(project(), ctx());
    expect(p.youtube!.warnings).toEqual(expect.arrayContaining([JPEG_WARNING, JPEG_STILL_BIG_WARNING]));
  });

  it('re-renders a missing option source before touching the current thumbnail', async () => {
    const r = render(() => 1000);
    const first = await packageStep({renderThumbnail: r})(project(), ctx());
    await fs.rm(path.join(dir, 'out', 'thumbnail-3.png'));
    r.mockClear();
    const next = await applyThumbnailChoice(dir, first, 2, {renderThumbnail: r});
    expect(r).toHaveBeenCalledTimes(1);
    expect(next.thumbnail).toMatchObject({chosen: 2, file: 'out/thumbnail.png'});
    expect(await exists('out/thumbnail.png')).toBe(true);
  });

  it('leaves the current thumbnail in place when the missing source cannot be rendered', async () => {
    const r = render(() => 1000);
    const first = await packageStep({renderThumbnail: r})(project(), ctx());
    await fs.rm(path.join(dir, 'out', 'thumbnail-3.png'));
    const boom = vi.fn(async () => {
      throw new Error('render failed');
    });
    await expect(applyThumbnailChoice(dir, first, 2, {renderThumbnail: boom})).rejects.toThrow('render failed');
    expect(await exists('out/thumbnail.png')).toBe(true);
  });
});
