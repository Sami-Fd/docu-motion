import {checkSceneLayout, MAX_OUTSIDE_PIXELS} from '../../render/layoutCheck.js';
import type {Project} from '../../project/schema.js';
import type {Step} from '../context.js';
import {applySceneResult, generateSceneSpec} from './scenes.js';

export const LAYOUT_WARNING = 'Layout may overflow the frame';
const FEEDBACK = 'The previous layout overflowed the frame; use shorter labels and fewer items.';

export function layoutStep(deps: {checkScene?: typeof checkSceneLayout} = {}): Step {
  const check = deps.checkScene ?? checkSceneLayout;
  return async (p, ctx) => {
    const n = p.scenes.length;
    let cur: Project = p;
    for (let i = 0; i < n; i++) {
      ctx.signal?.throwIfAborted();
      // Drop this step's own earlier warning; other steps' warnings stay as they are.
      const clean = (s: Project['scenes'][number]) => ({...s, warnings: s.warnings.filter((w) => w !== LAYOUT_WARNING)});
      const put = (s: Project['scenes'][number]): Project => ({...cur, scenes: cur.scenes.map((x, j) => (j === i ? s : x))});
      cur = put(clean(cur.scenes[i]!));
      let {outside} = await check(ctx.projectDir, cur, i);
      if (outside > MAX_OUTSIDE_PIXELS) {
        const r = await generateSceneSpec(cur, i, ctx, FEEDBACK);
        const before = cur.scenes[i]!;
        const applied = applySceneResult(before, r, cur);
        // Other steps' warnings are kept verbatim; only a fresh fallback warning of the regeneration is added.
        const extra = r.warning && !before.warnings.includes(r.warning) ? [r.warning] : [];
        cur = put({...applied, warnings: [...before.warnings, ...extra]});
        ({outside} = await check(ctx.projectDir, cur, i));
        if (outside > MAX_OUTSIDE_PIXELS) {
          const s = cur.scenes[i]!;
          cur = put({...s, warnings: [...s.warnings, LAYOUT_WARNING]});
        }
      }
      ctx.onProgress({step: 'layout', ratio: (i + 1) / n});
    }
    return cur;
  };
}
