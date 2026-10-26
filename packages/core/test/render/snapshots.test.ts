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
import {MAX_OUTSIDE_PIXELS, pixelsOutsideSafeArea} from '../../src/render/layoutCheck.js';
import {bundleScenes, invalidateBundle} from '../../src/render/bundle.js';
import {exampleProject} from './exampleProject.js';
import {half} from './snapshotUtil.js';

const SNAPSHOT_DIR = fileURLToPath(new URL('./__snapshots__/', import.meta.url));
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const STYLES: StyleName[] = ['papier', 'craie', 'infographie', 'nuit'];
const MAX_DIFF_RATIO = 0.005;
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
        const outside = pixelsOutsideSafeArea(png, bg);
        worst = Math.max(worst, outside);
        const line = `${type}-${style}: ${outside} px outside`;
        if (process.env.SAFE_AREA_VERBOSE) console.log(line);
        if (outside > MAX_OUTSIDE_PIXELS) report.push(line);
      }
    }
    console.log(`layout stays inside the safe area: max pixels outside = ${worst}`);
    expect(report).toEqual([]);
  }, 600_000);
});
