import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {SCENE_TYPES, type SceneSpec} from '@docu-motion/scenes';
import {checkSceneLayout, pixelsOutsideBox, pixelsOutsideSafeArea} from '../../src/render/layoutCheck.js';
import {invalidateBundle} from '../../src/render/bundle.js';
import {exampleProject} from './exampleProject.js';

const solid = (w: number, h: number, v: number): PNG => {
  const png = new PNG({width: w, height: h});
  png.data.fill(v);
  return png;
};
const paint = (png: PNG, x: number, y: number, v: number) => png.data.fill(v, (y * png.width + x) * 4, (y * png.width + x) * 4 + 4);

describe('pixelsOutsideBox', () => {
  it('counts changed pixels outside an arbitrary box, x1 and y1 exclusive', () => {
    const bg = solid(100, 50, 255);
    const scene = solid(100, 50, 255);
    paint(scene, 10, 10, 0); // inside
    paint(scene, 9, 10, 0); // left of x0
    paint(scene, 20, 10, 0); // x1 is exclusive
    paint(scene, 15, 30, 0); // y1 is exclusive
    expect(pixelsOutsideBox(scene, bg, {x0: 10, x1: 20, y0: 10, y1: 30})).toBe(3);
  });
});

describe('pixelsOutsideSafeArea', () => {
  it('counts changed pixels outside the safe area only', () => {
    const bg = solid(1920, 1080, 255);
    const scene = solid(1920, 1080, 255);
    paint(scene, 100, 100, 0); // inside
    expect(pixelsOutsideSafeArea(scene, bg)).toBe(0);
    paint(scene, 1885, 400, 0); // right of x1
    paint(scene, 59, 400, 0); // left of x0
    paint(scene, 500, 900, 0); // y1 is exclusive
    paint(scene, 500, 49, 0); // above y0
    expect(pixelsOutsideSafeArea(scene, bg)).toBe(4);
  });
  it('ignores deltas up to 8 per channel', () => {
    const bg = solid(1920, 1080, 255);
    const scene = solid(1920, 1080, 247);
    expect(pixelsOutsideSafeArea(scene, bg)).toBe(0);
    paint(scene, 1900, 400, 246);
    expect(pixelsOutsideSafeArea(scene, bg)).toBe(1);
  });
  it('scales the safe area with the image size', () => {
    const bg = solid(960, 540, 255);
    const scene = solid(960, 540, 255);
    paint(scene, 40, 200, 0); // 80 px at full size: inside
    paint(scene, 942, 200, 0); // 1884 px at full size: outside
    expect(pixelsOutsideSafeArea(scene, bg)).toBe(1);
  });
  it('rejects images of different sizes', () => {
    expect(() => pixelsOutsideSafeArea(solid(10, 10, 0), solid(20, 20, 0))).toThrow();
  });
});

describe('checkSceneLayout', () => {
  let root: string;
  let projectDir: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-layout-'));
    projectDir = path.join(root, 'projet é');
    await fs.mkdir(projectDir, {recursive: true});
  });
  afterAll(async () => {
    invalidateBundle(projectDir);
    await fs.rm(root, {recursive: true, force: true});
  });

  it('a well-fitted scene is inside the safe area; a title is exempt; stills stay out of out/stills', async () => {
    const p = exampleProject('papier');
    const bars = await checkSceneLayout(projectDir, p, SCENE_TYPES.indexOf('bars'));
    expect(bars.outside).toBeLessThanOrEqual(20);
    expect(await checkSceneLayout(projectDir, p, SCENE_TYPES.indexOf('title'))).toEqual({outside: 0});
    await expect(fs.stat(path.join(projectDir, 'out', 'stills'))).rejects.toThrow();
    await expect(fs.stat(path.join(projectDir, 'out', 'layout', 'bars.png'))).resolves.toBeTruthy();
  }, 300_000);

  it('a source line of 80 W overflows the right edge', async () => {
    const p = exampleProject('papier');
    const i = SCENE_TYPES.indexOf('bars');
    const spec = {...p.scenes[i]!.spec, source: 'W'.repeat(80)} as SceneSpec;
    p.scenes[i] = {...p.scenes[i]!, spec};
    const r = await checkSceneLayout(projectDir, p, i);
    expect(r.outside).toBeGreaterThan(20);
  }, 300_000);
});
