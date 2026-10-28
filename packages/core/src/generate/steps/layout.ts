import {checkSceneLayout, MAX_OUTSIDE_PIXELS} from '../../render/layoutCheck.js';
import type {Project} from '../../project/schema.js';
import type {Step, StepContext} from '../context.js';
import {applySceneResult, generateSceneSpec} from './scenes.js';

export const LAYOUT_WARNING = 'Layout may overflow the frame';
const FEEDBACK = 'The previous layout overflowed the frame; use shorter labels and fewer items.';

type LayoutDeps = {checkScene?: typeof checkSceneLayout};

/** Checks one scene's layout, regenerating its spec once when it overflows; other steps' warnings stay as they are. */
export async function layoutScene(p: Project, index: number, ctx: StepContext, deps: LayoutDeps = {}): Promise<Project> {
  const check = deps.checkScene ?? checkSceneLayout;
  // Drop this step's own earlier warning.
  const clean = (s: Project['scenes'][number]) => ({...s, warnings: s.warnings.filter((w) => w !== LAYOUT_WARNING)});
  const put = (cur: Project, s: Project['scenes'][number]): Project => ({...cur, scenes: cur.scenes.map((x, j) => (j === index ? s : x))});
  let cur = put(p, clean(p.scenes[index]!));
  let {outside} = await check(ctx.projectDir, cur, index);
  if (outside > MAX_OUTSIDE_PIXELS) {
    const r = await generateSceneSpec(cur, index, ctx, FEEDBACK);
    // An unusable regeneration (LlmOutputError → fallback) keeps the original spec:
    // a slightly overflowing data scene beats a plain fallback title.
    if (r.status !== 'fallback') {
      cur = put(cur, applySceneResult(cur.scenes[index]!, r, cur));
      ({outside} = await check(ctx.projectDir, cur, index));
    }
    if (outside > MAX_OUTSIDE_PIXELS) {
      const s = cur.scenes[index]!;
      cur = put(cur, {...s, warnings: [...s.warnings, LAYOUT_WARNING]});
    }
  }
  return cur;
}

export function layoutStep(deps: LayoutDeps = {}): Step {
  return async (p, ctx) => {
    const n = p.scenes.length;
    let cur: Project = p;
    for (let i = 0; i < n; i++) {
      ctx.signal?.throwIfAborted();
      cur = await layoutScene(cur, i, ctx, deps);
      ctx.onProgress({step: 'layout', ratio: (i + 1) / n});
    }
    return cur;
  };
}
