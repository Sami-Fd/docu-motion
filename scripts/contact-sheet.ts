// Renders a still of every scene of a project (at 80 % of each scene) and assembles them into one
// PNG grid for eyeballing: overlaps, overflowing text, legibility of the chosen style.
//   npm run sheet -- <projectDir>      -> <projectDir>/out/contact-sheet.png
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {loadProject} from '../packages/core/src/index.js';
import {renderSceneStill} from '../packages/core/src/render/render.js';

const COLUMNS = 3;
const THUMB_W = 640;
const THUMB_H = 360;
const GAP = 12;
const BACKDROP = [40, 40, 40, 255] as const;

/** Box-filter downscale (source dimensions must be integer multiples of the target ones). */
const downscale = (src: PNG, w: number, h: number): PNG => {
  const fx = Math.floor(src.width / w);
  const fy = Math.floor(src.height / h);
  const out = new PNG({width: w, height: h});
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < fy; dy++) {
        for (let dx = 0; dx < fx; dx++) {
          const i = ((y * fy + dy) * src.width + (x * fx + dx)) * 4;
          for (let c = 0; c < 4; c++) acc[c]! += src.data[i + c]!;
        }
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out.data[o + c] = Math.round(acc[c]! / (fx * fy));
    }
  }
  return out;
};

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npm run sheet -- <projectDir>');
    process.exit(2);
  }
  const projectDir = path.resolve(arg);
  const project = await loadProject(projectDir);
  if (project.scenes.length === 0) throw new Error(`${projectDir} has no scenes`);

  const thumbs: PNG[] = [];
  for (let i = 0; i < project.scenes.length; i++) {
    const file = await renderSceneStill(projectDir, project, i);
    console.log(`still ${i + 1}/${project.scenes.length}: ${file}`);
    thumbs.push(downscale(PNG.sync.read(await fs.readFile(file)), THUMB_W, THUMB_H));
  }

  const cols = Math.min(COLUMNS, thumbs.length);
  const rows = Math.ceil(thumbs.length / cols);
  const sheet = new PNG({width: cols * THUMB_W + (cols + 1) * GAP, height: rows * THUMB_H + (rows + 1) * GAP});
  for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set(BACKDROP, i);
  thumbs.forEach((t, k) => {
    const ox = GAP + (k % cols) * (THUMB_W + GAP);
    const oy = GAP + Math.floor(k / cols) * (THUMB_H + GAP);
    PNG.bitblt(t, sheet, 0, 0, THUMB_W, THUMB_H, ox, oy);
  });
  const output = path.join(projectDir, 'out', 'contact-sheet.png');
  await fs.mkdir(path.dirname(output), {recursive: true});
  await fs.writeFile(output, PNG.sync.write(sheet));
  console.log(output);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
