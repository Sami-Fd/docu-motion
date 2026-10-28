import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {THUMBNAIL_EXAMPLES, type StyleName} from '@docu-motion/scenes';
import type {StepContext} from '../../src/generate/context.js';
import {JPEG_WARNING, packageStep} from '../../src/generate/steps/package.js';
import {demoResponder} from '../../src/llm/demoResponder.js';
import {invalidateBundle} from '../../src/render/bundle.js';
import {renderThumbnail} from '../../src/render/render.js';
import {exampleProject} from './exampleProject.js';

const STYLES: StyleName[] = ['papier', 'craie', 'infographie', 'nuit'];
const MAX = 2 * 1024 * 1024;

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-package-'));
});
afterAll(async () => {
  for (const s of STYLES) invalidateBundle(path.join(root, s));
  await fs.rm(root, {recursive: true, force: true});
});

// Offline LLM: the thumbnails are the three reference examples, the rest comes from the demo responder.
const llm = {
  name: 'fake',
  capabilities: {nativeWebSearch: false, vision: false},
  generateObject: async ({schema, system, prompt}: {schema: never; system: string; prompt: string}) =>
    /thumbnail/i.test(system) ? {options: THUMBNAIL_EXAMPLES} : demoResponder({schema, system, prompt}),
  generateText: async () => '',
};
const ctxOf = (dir: string) => ({projectDir: dir, llm, settings: {keys: {}}, onProgress: () => {}}) as unknown as StepContext;

/** Width and height of a JPEG, read from its SOF marker; throws when the stream is not a JPEG. */
function jpegSize(buf: Buffer): {width: number; height: number} {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Not a JPEG (no SOI)');
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) throw new Error('Truncated JPEG (no EOI)');
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) throw new Error('Bad JPEG marker');
    const marker = buf[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7)};
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('No SOF marker');
}

describe('package step with real thumbnail renders', () => {
  it.each(STYLES)('%s: the final thumbnail is a valid image of at most 2 MB', async (style) => {
    const dir = path.join(root, style);
    await fs.mkdir(dir, {recursive: true});
    const p = await packageStep()(exampleProject(style), ctxOf(dir));
    const file = path.join(dir, p.thumbnail!.file);
    const buf = await fs.readFile(file);
    const sizes = await Promise.all([1, 2, 3].map(async (i) => (await fs.stat(path.join(dir, 'out', `thumbnail-${i}.png`))).size));
    console.log(`thumbnail ${style}: final ${p.thumbnail!.file} ${buf.length} bytes; PNG options ${sizes.join(', ')} bytes`);
    expect(buf.length).toBeLessThanOrEqual(MAX);
    if (file.endsWith('.png')) {
      const png = PNG.sync.read(buf);
      expect([png.width, png.height]).toEqual([1280, 720]);
    } else {
      expect(jpegSize(buf)).toEqual({width: 1280, height: 720});
      expect(p.youtube!.warnings).toContain(JPEG_WARNING);
    }
    expect((await fs.readdir(path.join(dir, 'out'))).filter((f) => /^thumbnail\.(png|jpg)$/.test(f))).toHaveLength(1);
  }, 300_000);

  it.each(['papier', 'craie'] as const)('%s: a real JPEG render is valid, 1280x720 and under 2 MB', async (style) => {
    const dir = path.join(root, `jpeg-${style}`);
    await fs.mkdir(dir, {recursive: true});
    const out = await renderThumbnail(dir, exampleProject(style), THUMBNAIL_EXAMPLES[0]!, path.join(dir, 'out', 'thumbnail.jpg'));
    const buf = await fs.readFile(out);
    console.log(`thumbnail ${style} as JPEG q90: ${buf.length} bytes`);
    expect(jpegSize(buf)).toEqual({width: 1280, height: 720});
    expect(buf.length).toBeLessThanOrEqual(MAX);
    invalidateBundle(dir);
  }, 300_000);

  it('takes the JPEG path through the real renderer when the PNG is over 2 MB', async () => {
    const dir = path.join(root, 'fallback');
    await fs.mkdir(dir, {recursive: true});
    // Real renders; only the PNGs get 2.5 MB of trailing bytes (ignored by PNG readers) to cross the limit.
    const bloated: typeof renderThumbnail = async (d, p, spec, out) => {
      await renderThumbnail(d, p, spec, out);
      if (out.endsWith('.png')) await fs.appendFile(out, randomBytes(2_500_000));
      return out;
    };
    const p = await packageStep({renderThumbnail: bloated})(exampleProject('papier'), ctxOf(dir));
    expect(p.thumbnail!.file).toBe('out/thumbnail.jpg');
    expect(p.youtube!.warnings).toContain(JPEG_WARNING);
    const buf = await fs.readFile(path.join(dir, 'out', 'thumbnail.jpg'));
    expect(jpegSize(buf)).toEqual({width: 1280, height: 720});
    expect(buf.length).toBeLessThanOrEqual(MAX);
    await expect(fs.stat(path.join(dir, 'out', 'thumbnail.png'))).rejects.toThrow();
    invalidateBundle(dir);
  }, 300_000);
});
