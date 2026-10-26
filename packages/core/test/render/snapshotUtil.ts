import {PNG} from 'pngjs';

// Snapshots are stored at half resolution (2x2 box filter): the paper and chalk grain makes
// full-size PNGs ~1.5 to 3.5 MB each.
export const half = (src: PNG): PNG => {
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
