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
import {bundleScenes, invalidateBundle} from '../../src/render/bundle.js';
import {exampleProject} from './exampleProject.js';

const SNAPSHOT_DIR = fileURLToPath(new URL('./__snapshots__/', import.meta.url));
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const STYLES: StyleName[] = ['papier', 'craie', 'infographie', 'nuit'];
const MAX_DIFF_RATIO = 0.005;
// Safe-area test: everything a scene draws on top of its background (Label zone, content, Source line)
// must stay inside this rectangle. `title` is exempt: its hills / sea are full-bleed by design.
// y0 is 50, not 90: the Label (y = 150, 130 px high) starts at y = 85 before its -1.5° tilt, its
// paper displacement and the nuit glow; measured tops are 58 (nuit) to 75 (papier).
const SAFE = {x0: 60, x1: 1860, y0: 50, y1: 900};
// Anti-aliasing tolerance: a channel delta up to this counts as identical; a few odd pixels are allowed.
const CHANNEL_TOLERANCE = 8;
const MAX_OUTSIDE_PIXELS = 20;
const IN_CI = Boolean(process.env.CI);

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
  invalidateBundle(projectDir); // the temp project goes away, so does its bundle
  await fs.rm(root, {recursive: true, force: true});
});

// Snapshots are stored at half resolution (2x2 box filter): the paper and chalk grain makes
// full-size PNGs ~3.5 MB each (65 MB for 36), half-size ones ~15 MB in total.
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
    const missing = !existsSync(snapshot);
    if (missing && !UPDATE && IN_CI) {
      throw new Error(`Missing snapshot ${snapshot}. Record it locally with UPDATE_SNAPSHOTS=1 npm run test:visual -- snapshots`);
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
      const actual = path.join(os.tmpdir(), `docu-motion-${type}-${style}.actual.png`);
      await fs.writeFile(actual, PNG.sync.write(png));
      await fs.writeFile(actual.replace('.actual.png', '.diff.png'), PNG.sync.write(diff));
      throw new Error(`${type}-${style}: ${(ratio * 100).toFixed(2)} % of pixels differ (max 0.5 %), see ${actual}`);
    }
  }, 180_000);

  it('layout stays inside the safe area', async () => {
    const report: string[] = [];
    let worst = 0;
    for (const style of STYLES) {
      const bg = await renderBackground(style);
      for (const type of SCENE_TYPES) {
        if (type === 'title') continue;
        const png = await renderExample(type, style);
        let outside = 0;
        const box = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
        for (let y = 0; y < png.height; y++) {
          for (let x = 0; x < png.width; x++) {
            const i = (y * png.width + x) * 4;
            let differs = false;
            for (let c = 0; c < 4 && !differs; c++) {
              differs = Math.abs(png.data[i + c]! - bg.data[i + c]!) > CHANNEL_TOLERANCE;
            }
            if (!differs) continue;
            box.x0 = Math.min(box.x0, x);
            box.y0 = Math.min(box.y0, y);
            box.x1 = Math.max(box.x1, x);
            box.y1 = Math.max(box.y1, y);
            if (x < SAFE.x0 || x >= SAFE.x1 || y < SAFE.y0 || y >= SAFE.y1) outside++;
          }
        }
        worst = Math.max(worst, outside);
        const line = `${type}-${style}: drawn area x ${box.x0}-${box.x1}, y ${box.y0}-${box.y1}, ${outside} px outside`;
        if (process.env.SAFE_AREA_VERBOSE) console.log(line);
        if (outside > MAX_OUTSIDE_PIXELS) report.push(line);
      }
    }
    console.log(`layout stays inside the safe area: max pixels outside = ${worst}`);
    expect(report).toEqual([]);
  }, 600_000);
});
