import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {StepContext} from '../../src/generate/context.js';
import {packageStep, JPEG_WARNING} from '../../src/generate/steps/package.js';
import {demoResponder} from '../../src/llm/demoResponder.js';
import {ProjectSchema, type Project} from '../../src/project/schema.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'package-unit-'));
});
afterEach(() => fs.rm(dir, {recursive: true, force: true}));

const llm = {
  name: 'fake',
  capabilities: {nativeWebSearch: false, vision: false},
  generateObject: async ({schema, system, prompt}: {schema: never; system: string; prompt: string}) =>
    demoResponder({schema, system, prompt}),
  generateText: async () => '',
};
const ctx = (): StepContext => ({projectDir: dir, llm, settings: {keys: {}}, onProgress: () => {}}) as unknown as StepContext;
const project = (): Project =>
  ({
    version: 1,
    brief: {topic: 'Les retraites', language: 'fr', style: 'papier'},
    sources: [],
    facts: [],
    scenes: [12, 12, 12, 12].map((s, i) => ({
      id: `s${i + 1}`,
      narration: `Voici la scène numéro ${i + 1}.`,
      spec: {type: 'title', title: `Titre ${i + 1}`, decor: 'none', characters: 0},
      status: 'ok',
      durationFrames: s * 30,
      factIds: [],
      warnings: [],
    })),
    voice: {engine: 'none'},
    progress: {done: []},
  }) as unknown as Project;

const writer = (bytes: number) =>
  vi.fn(async (_dir: string, _p: Project, _spec: unknown, out: string) => {
    await fs.mkdir(path.dirname(out), {recursive: true});
    await fs.writeFile(out, Buffer.alloc(bytes, 1));
    return out;
  });
const exists = (f: string) => fs.stat(path.join(dir, f)).then(() => true, () => false);

describe('packageStep', () => {
  it('renders three options, copies the chosen one and writes the kit', async () => {
    const renderThumbnail = writer(10_000);
    const p = await packageStep({renderThumbnail})(project(), ctx());
    expect(renderThumbnail).toHaveBeenCalledTimes(3);
    for (const f of ['out/thumbnail-1.png', 'out/thumbnail-2.png', 'out/thumbnail-3.png', 'out/thumbnail.png', 'out/youtube.txt', 'out/narration.txt']) {
      expect(await exists(f), f).toBe(true);
    }
    expect(p.thumbnail).toMatchObject({chosen: 0, file: 'out/thumbnail.png'});
    expect(p.thumbnail!.options).toHaveLength(3);
    expect(p.youtube!.titles).toHaveLength(3);
    expect(p.youtube!.chapters.map((c) => c.t)).toEqual(['0:00', '0:12', '0:24', '0:36']);
    expect(p.youtube!.warnings).toEqual([]);
    expect(p.youtube!.description).toContain('0:00 Titre 1');
    const txt = await fs.readFile(path.join(dir, 'out/youtube.txt'), 'utf8');
    expect(txt.startsWith('1. ')).toBe(true);
    expect(txt).toContain('\n2. ');
    expect(txt).toContain(p.youtube!.description);
    expect(await fs.readFile(path.join(dir, 'out/narration.txt'), 'utf8')).toBe(
      'Voici la scène numéro 1.\n\nVoici la scène numéro 2.\n\nVoici la scène numéro 3.\n\nVoici la scène numéro 4.\n',
    );
    expect(ProjectSchema.shape.youtube.parse(JSON.parse(JSON.stringify(p.youtube)))).toEqual(p.youtube);
    expect(ProjectSchema.shape.thumbnail.parse(JSON.parse(JSON.stringify(p.thumbnail)))).toEqual(p.thumbnail);
  });

  it('falls back to JPEG when the PNG is over 2 MB', async () => {
    const renderThumbnail = vi.fn(async (_d: string, _p: Project, _s: unknown, out: string) => {
      await fs.mkdir(path.dirname(out), {recursive: true});
      await fs.writeFile(out, Buffer.alloc(out.endsWith('.jpg') ? 100_000 : 3_000_000, 1));
      return out;
    });
    const p = await packageStep({renderThumbnail})(project(), ctx());
    expect(p.thumbnail!.file).toBe('out/thumbnail.jpg');
    expect(await exists('out/thumbnail.jpg')).toBe(true);
    expect(await exists('out/thumbnail.png')).toBe(false);
    expect(p.youtube!.warnings).toContain(JPEG_WARNING);
    expect(JPEG_WARNING).toBe('Thumbnail saved as JPEG (PNG over 2 MB)');
  });

  it('adds the chapters warning and omits chapters when too few remain', async () => {
    const p0 = project();
    p0.scenes = p0.scenes.slice(0, 2);
    const p = await packageStep({renderThumbnail: writer(1000)})(p0, ctx());
    expect(p.youtube!.chapters).toEqual([]);
    expect(p.youtube!.warnings).toContain('Too few chapters for YouTube (need 3 of ≥ 10 s)');
    expect(p.youtube!.description).not.toContain('0:00');
  });
});
