import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {existsSync, promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {renderStill, selectComposition} from '@remotion/renderer';
import {THUMBNAIL_EXAMPLES, type StyleName, type ThumbnailSpec} from '@docu-motion/scenes';
import {bundleScenes, invalidateBundle} from '../../src/render/bundle.js';
import {pixelsOutsideBox} from '../../src/render/layoutCheck.js';
import {half} from './snapshotUtil.js';

const SNAPSHOT_DIR = fileURLToPath(new URL('./__snapshots__/', import.meta.url));
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const IN_CI = Boolean(process.env.CI);
const STYLES: StyleName[] = ['papier', 'craie', 'infographie', 'nuit'];
const MAX_DIFF_RATIO = 0.005;
// Everything the thumbnail draws on top of its background must stay this far (px) from every edge.
const INSET = 40;

let root: string;
let projectDir: string;
let counter = 0;

const still = async (id: 'Thumbnail' | 'ThumbnailBackground', style: StyleName, spec?: ThumbnailSpec): Promise<PNG> => {
  const serveUrl = await bundleScenes(projectDir);
  const inputProps = spec ? {style, spec} : {style};
  const composition = await selectComposition({serveUrl, id, inputProps});
  expect([composition.width, composition.height, composition.durationInFrames]).toEqual([1280, 720, 1]);
  const output = path.join(projectDir, 'out', `${id}-${style}-${counter++}.png`);
  await renderStill({composition, serveUrl, inputProps, frame: 0, output});
  return PNG.sync.read(await fs.readFile(output));
};

// The words must stay in the left 60 % of the frame.
const ZONE_X1 = 768;
const insideInset = (png: PNG) => ({x0: INSET, x1: png.width - INSET, y0: INSET, y1: png.height - INSET});

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-thumbnail-'));
  projectDir = path.join(root, 'miniature é');
  await fs.mkdir(projectDir, {recursive: true});
});
afterAll(async () => {
  invalidateBundle(projectDir);
  await fs.rm(root, {recursive: true, force: true});
});

const cases = THUMBNAIL_EXAMPLES.flatMap((_, i) => STYLES.map((style) => [i, style] as const));

describe('thumbnail snapshots', () => {
  it.each(cases)('example %i in %s matches its snapshot', async (i, style) => {
    const png = half(await still('Thumbnail', style, THUMBNAIL_EXAMPLES[i]!));
    const snapshot = path.join(SNAPSHOT_DIR, `thumbnail-${i}-${style}.png`);
    const missing = !existsSync(snapshot);
    if (missing && !UPDATE && IN_CI) {
      throw new Error(`Missing snapshot ${snapshot}. Record it with UPDATE_SNAPSHOTS=1 (docker compose --profile dev run --rm -e UPDATE_SNAPSHOTS=1 dev test:visual -- thumbnail)`);
    }
    if (UPDATE || missing) {
      await fs.mkdir(SNAPSHOT_DIR, {recursive: true});
      await fs.writeFile(snapshot, PNG.sync.write(png));
      return;
    }
    const expected = PNG.sync.read(await fs.readFile(snapshot));
    expect([png.width, png.height]).toEqual([expected.width, expected.height]);
    const diff = new PNG({width: png.width, height: png.height});
    const changed = pixelmatch(png.data, expected.data, diff.data, png.width, png.height, {threshold: 0.1});
    const ratio = changed / (png.width * png.height);
    if (ratio > MAX_DIFF_RATIO) {
      const actual = path.join(os.tmpdir(), `docu-motion-thumbnail-${i}-${style}.actual.png`);
      await fs.writeFile(actual, PNG.sync.write(png));
      throw new Error(`thumbnail-${i}-${style}: ${(ratio * 100).toFixed(2)} % of pixels differ (max 0.5 %), see ${actual}`);
    }
  }, 180_000);
});

describe('thumbnail stays inside the frame', () => {
  it('the examples draw nothing within 40 px of the edges', async () => {
    for (const style of STYLES) {
      const bg = await still('ThumbnailBackground', style);
      for (const spec of THUMBNAIL_EXAMPLES) {
        const png = await still('Thumbnail', style, spec);
        expect(pixelsOutsideBox(png, bg, insideInset(png)), style).toBe(0);
      }
    }
  }, 300_000);

  it('4 words of 14 W stay inside, as do accents and emoji', async () => {
    const stress: ThumbnailSpec[] = [
      {words: Array<string>(4).fill('W'.repeat(14)), figure: 'W'.repeat(12), characters: 2, element: 'coin', highlight: 3},
      {words: ['Sécu 🏥', 'ÉÀÇÜ', 'Œuvre', 'Ñandú'], figure: '99 Md€', characters: 1, element: 'question', highlight: 0},
    ];
    for (const style of STYLES) {
      const bg = await still('ThumbnailBackground', style);
      for (const spec of stress) {
        const png = await still('Thumbnail', style, spec);
        expect(pixelsOutsideBox(png, bg, insideInset(png)), style).toBe(0);
      }
    }
  }, 300_000);
});

// Widths the old estimate got wrong (wide lowercase, ligature capitals, symbols): the words must still end
// inside the left 60 %. The same spec with invisible words (no-break spaces) isolates them: everything right
// of the text zone (badge, element, characters) is identical, so any difference there is a word overflowing.
describe('words stay in the left 60 % of the frame', () => {
  const specs: ThumbnailSpec[] = [
    {words: ['mmmmmmmmmmmmmm', 'ok'], characters: 1, element: 'none', highlight: 0},
    {words: ['ŒWŒWŒWŒWŒWŒWŒW', '%@%@'], figure: '%@%@%@', characters: 2, element: 'coin', highlight: 1},
    {words: ['ÆÆÆÆÆÆÆÆÆÆÆÆÆÆ', 'wwwwwwwwwwwwww', 'iiiiiiiiiiiiii', 'ß'], characters: 1, element: 'question', highlight: 2},
  ];
  it.each(STYLES)('%s', async (style) => {
    for (const spec of specs) {
      const hidden = await still('Thumbnail', style, {...spec, words: spec.words.map(() => ' ')});
      const png = await still('Thumbnail', style, spec);
      const zone = {x0: 0, x1: ZONE_X1, y0: 0, y1: png.height};
      expect(pixelsOutsideBox(png, hidden, zone), JSON.stringify(spec.words)).toBe(0);
    }
  }, 300_000);
});
