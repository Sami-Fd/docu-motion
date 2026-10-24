import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {existsSync, promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {renderStill, selectComposition} from '@remotion/renderer';
import {SCENE_TYPES, type SceneType, type StyleName} from '@docu-motion/scenes';
import {renderSceneStill} from '../../src/render/render.js';
import {bundleScenes} from '../../src/render/bundle.js';
import {exampleProject} from './exampleProject.js';

const SNAPSHOT_DIR = fileURLToPath(new URL('./__snapshots__/', import.meta.url));
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const STYLES: StyleName[] = ['papier', 'craie', 'infographie', 'nuit'];
const MAX_DIFF_RATIO = 0.005;
const BORDER = 30;
// Anti-aliasing tolerance for the border test: channel delta treated as identical, and allowed odd pixels.
const BORDER_CHANNEL_TOLERANCE = 8;
const BORDER_MAX_PIXELS = 20;

let root: string;
// One project dir (hence one bundle) for every render; the style comes from the project props.
let projectDir: string;
const renders = new Map<string, PNG>();

const renderExample = async (type: SceneType, style: StyleName): Promise<PNG> => {
  const key = `${type}-${style}`;
  let png = renders.get(key);
  if (!png) {
    const p = exampleProject(style);
    const file = await renderSceneStill(projectDir, p, SCENE_TYPES.indexOf(type), 0.8);
    png = PNG.sync.read(await fs.readFile(file));
    renders.set(key, png);
  }
  return png;
};

const renderBackground = async (style: StyleName): Promise<PNG> => {
  const serveUrl = await bundleScenes(projectDir);
  const inputProps = {style};
  const composition = await selectComposition({serveUrl, id: 'BackgroundStill', inputProps});
  const output = path.join(projectDir, 'out', `background-${style}.png`);
  await renderStill({composition, serveUrl, inputProps, frame: 0, output});
  return PNG.sync.read(await fs.readFile(output));
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-snapshots-'));
  projectDir = path.join(root, 'exemples é');
  await fs.mkdir(projectDir, {recursive: true});
});
afterAll(async () => {
  await fs.rm(root, {recursive: true, force: true});
});

// Snapshots are stored at half resolution (2x2 box filter): the paper and chalk grain makes
// full-size PNGs ~3.5 MB each (65 MB for 36), half-size ones ~19 MB in total.
const half = (src: PNG): PNG => {
  const w = src.width / 2;
  const h = src.height / 2;
  const out = new PNG({width: w, height: h});
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        const at = (dx: number, dy: number) => src.data[((2 * y + dy) * src.width + 2 * x + dx) * 4 + c]!;
        out.data[(y * w + x) * 4 + c] = Math.round((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4);
      }
    }
  }
  return out;
};

const cases = STYLES.flatMap((style) => SCENE_TYPES.map((type) => [type, style] as const));

describe('scene snapshots', () => {
  it.each(cases)('%s in %s matches its snapshot', async (type, style) => {
    const png = half(await renderExample(type, style));
    const snapshot = path.join(SNAPSHOT_DIR, `${type}-${style}.png`);
    if (UPDATE || !existsSync(snapshot)) {
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
      const actual = path.join(os.tmpdir(), `docu-motion-${type}-${style}.actual.png`);
      await fs.writeFile(actual, PNG.sync.write(png));
      await fs.writeFile(actual.replace('.actual.png', '.diff.png'), PNG.sync.write(diff));
      throw new Error(`${type}-${style}: ${(ratio * 100).toFixed(2)} % of pixels differ (max 0.5 %), see ${actual}`);
    }
  }, 180_000);

  it('layout stays inside frame', async () => {
    const report: string[] = [];
    let worst = 0;
    for (const style of STYLES) {
      const bg = await renderBackground(style);
      for (const type of SCENE_TYPES) {
        const png = await renderExample(type, style);
        let differing = 0;
        for (let y = 0; y < png.height; y++) {
          for (let x = 0; x < png.width; x++) {
            const inBand = x < BORDER || x >= png.width - BORDER || y < BORDER || y >= png.height - BORDER;
            if (!inBand) continue;
            const i = (y * png.width + x) * 4;
            for (let c = 0; c < 4; c++) {
              if (Math.abs(png.data[i + c]! - bg.data[i + c]!) > BORDER_CHANNEL_TOLERANCE) {
                differing++;
                break;
              }
            }
          }
        }
        worst = Math.max(worst, differing);
        if (differing > BORDER_MAX_PIXELS) report.push(`${type}-${style}: ${differing} border pixels differ from the background`);
      }
    }
    console.log(`layout stays inside frame: max differing border pixels = ${worst}`);
    expect(report).toEqual([]);
  }, 600_000);
});
