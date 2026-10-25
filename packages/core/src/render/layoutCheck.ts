import {promises as fs} from 'node:fs';
import path from 'node:path';
import {renderStill, selectComposition} from '@remotion/renderer';
import {PNG} from 'pngjs';
import type {StyleName} from '@docu-motion/scenes';
import type {Project} from '../project/schema.js';
import {bundleScenes} from './bundle.js';
import {renderSceneStill} from './render.js';
import {filmAssets, toFilmInput} from './toFilmInput.js';

// Everything a scene draws on top of its background (Label zone, content, Source line) must stay inside
// this rectangle, defined for a 1920-px-wide frame. y0 is 50, not 90: the Label (y = 150, 130 px high)
// starts at y = 85 before its -1.5° tilt, its paper displacement and the nuit glow; measured tops are
// 58 (nuit) to 75 (papier).
export const SAFE = {x0: 60, x1: 1860, y0: 50, y1: 900};
const FRAME_WIDTH = 1920;
// Anti-aliasing tolerance: a channel delta up to this counts as identical.
const CHANNEL_TOLERANCE = 8;
/** A few odd pixels are allowed outside the safe area. */
export const MAX_OUTSIDE_PIXELS = 20;

/**
 * Counts the pixels that differ from the bare background and lie outside the safe area. The safe area
 * scales with the image width, so half-resolution images work too.
 */
export function pixelsOutsideSafeArea(scenePng: PNG, backgroundPng: PNG): number {
  if (scenePng.width !== backgroundPng.width || scenePng.height !== backgroundPng.height) {
    throw new Error('Scene and background images must have the same size');
  }
  const k = scenePng.width / FRAME_WIDTH;
  const x0 = SAFE.x0 * k;
  const x1 = SAFE.x1 * k;
  const y0 = SAFE.y0 * k;
  const y1 = SAFE.y1 * k;
  let outside = 0;
  for (let y = 0; y < scenePng.height; y++) {
    for (let x = 0; x < scenePng.width; x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      const i = (y * scenePng.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(scenePng.data[i + c]! - backgroundPng.data[i + c]!) > CHANNEL_TOLERANCE) {
          outside++;
          break;
        }
      }
    }
  }
  return outside;
}

const backgrounds = new Map<StyleName, Promise<PNG>>();

function backgroundOf(projectDir: string, p: Project, style: StyleName): Promise<PNG> {
  let hit = backgrounds.get(style);
  if (!hit) {
    hit = (async () => {
      const serveUrl = await bundleScenes(projectDir, filmAssets(toFilmInput(p, projectDir, null)));
      const inputProps = {style};
      const composition = await selectComposition({serveUrl, id: 'BackgroundStill', inputProps});
      const output = path.join(projectDir, 'out', 'layout', `background-${style}.png`);
      await fs.mkdir(path.dirname(output), {recursive: true});
      await renderStill({composition, serveUrl, inputProps, frame: 0, output});
      return PNG.sync.read(await fs.readFile(output));
    })();
    hit.catch(() => backgrounds.delete(style));
    backgrounds.set(style, hit);
  }
  return hit;
}

/** Renders scene `index` and counts the pixels it draws outside the safe area. Title scenes are full-bleed by design. */
export async function checkSceneLayout(projectDir: string, p: Project, index: number): Promise<{outside: number}> {
  const scene = p.scenes[index];
  if (!scene) throw new Error(`Scene index ${index} is out of range (${p.scenes.length} scenes)`);
  if (scene.spec.type === 'title') return {outside: 0};
  const file = await renderSceneStill(projectDir, p, index, 0.8, path.join(projectDir, 'out', 'layout'));
  const scenePng = PNG.sync.read(await fs.readFile(file));
  const bg = await backgroundOf(projectDir, p, p.brief.style);
  return {outside: pixelsOutsideSafeArea(scenePng, bg)};
}
