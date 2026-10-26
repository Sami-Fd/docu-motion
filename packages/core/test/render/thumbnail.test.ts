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

const SNAPSHOT_DIR = fileURLToPath(new URL('./__snapshots__/', import.meta.url));
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const IN_CI = Boolean(process.env.CI);
const STYLES: StyleName[] = ['papier', 'craie', 'infographie', 'nuit'];
const MAX_DIFF_RATIO = 0.005;
// Everything the thumbnail draws on top of its background must stay this far (px) from every edge.
const INSET = 40;
const MAX_OUTSIDE_PIXELS = 20;
const CHANNEL_TOLERANCE = 8;

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

const outsideInset = (a: PNG, b: PNG): number => {
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (x >= INSET && x < a.width - INSET && y >= INSET && y < a.height - INSET) continue;
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(a.data[i + c]! - b.data[i + c]!) > CHANNEL_TOLERANCE) {
          n++;
          break;
        }
      }
    }
  }
  return n;
};

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
    const png = await still('Thumbnail', style, THUMBNAIL_EXAMPLES[i]!);
    const snapshot = path.join(SNAPSHOT_DIR, `thumbnail-${i}-${style}.png`);
    const missing = !existsSync(snapshot);
    if (missing && !UPDATE && IN_CI) {
      throw new Error(`Missing snapshot ${snapshot}. Record it locally with UPDATE_SNAPSHOTS=1 npm run test:visual -- thumbnail`);
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
        expect(outsideInset(await still('Thumbnail', style, spec), bg), style).toBeLessThanOrEqual(MAX_OUTSIDE_PIXELS);
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
        expect(outsideInset(await still('Thumbnail', style, spec), bg), style).toBeLessThanOrEqual(MAX_OUTSIDE_PIXELS);
      }
    }
  }, 300_000);
});
