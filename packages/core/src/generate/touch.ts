import type {Project, StepName} from '../project/schema.js';
import {loadProject, saveProject} from '../project/store.js';
import type {Step, StepContext} from './context.js';
import {generate} from './generate.js';
import {layoutScene} from './steps/layout.js';
import {applyThumbnailChoice, type RenderThumbnail} from './steps/package.js';
import {applySceneResult, generateSceneSpec} from './steps/scenes.js';

export const NARRATION_MAX = 2000;

// These operations load, change and save project.json without a lock: Plan 2 has no project lock or
// in-progress guard, so callers (CLI, UI) must not run two of them on the same project at once.

const without = (p: Project, ...names: StepName[]): Project => ({
  ...p,
  progress: {...p.progress, done: p.progress.done.filter((d) => !names.includes(d))},
});

function indexOfScene(p: Project, sceneId: string): number {
  const i = p.scenes.findIndex((s) => s.id === sceneId);
  if (i >= 0) return i;
  const first = p.scenes[0]?.id;
  const last = p.scenes[p.scenes.length - 1]?.id;
  const range = first === undefined ? 'none' : first === last ? first : `${first}…${last}`;
  throw new Error(`Unknown scene "${sceneId}" — scenes are ${range}`);
}

/** Asks the LLM for a new spec of one scene, re-checks its layout. Does not re-render: the caller runs `rerender`. */
export async function regenerateScene(
  projectDir: string,
  sceneId: string,
  ctx: Omit<StepContext, 'projectDir'>,
  deps: Parameters<typeof layoutScene>[3] = {},
): Promise<Project> {
  let p = await loadProject(projectDir);
  const i = indexOfScene(p, sceneId);
  const full: StepContext = {...ctx, projectDir};
  const r = await generateSceneSpec(p, i, full);
  // Never swap a working scene for the plain fallback title: keep it and tell the user.
  if (r.status === 'fallback') {
    throw new Error(`Could not regenerate ${sceneId}: the LLM output was unusable — the scene was left unchanged`);
  }
  p = {...p, scenes: p.scenes.map((s, j) => (j === i ? applySceneResult(s, r, p) : s))};
  // layoutScene drops this scene's stale layout warning before checking again.
  p = without(await layoutScene(p, i, full, deps), 'render', 'package');
  await saveProject(projectDir, p);
  return p;
}

/** Replaces one scene's narration; the voice step re-synthesizes it (hash mismatch) on the next `rerender`. */
export async function editNarration(projectDir: string, sceneId: string, text: string): Promise<Project> {
  const narration = text.trim();
  if ([...narration].length < 1 || [...narration].length > NARRATION_MAX) {
    throw new Error(`Narration must be between 1 and ${NARRATION_MAX} characters`);
  }
  const p0 = await loadProject(projectDir);
  const i = indexOfScene(p0, sceneId);
  const p = without(
    {...p0, scenes: p0.scenes.map((s, j) => (j === i ? {...s, narration, dirty: true} : s))},
    'voice',
    'render',
    'package',
  );
  await saveProject(projectDir, p);
  return p;
}

/** Re-runs voice (changed scenes only), render and package; layout is kept. */
export async function rerender(
  projectDir: string,
  ctx: Omit<StepContext, 'projectDir'>,
  deps: {steps?: Partial<Record<StepName, Step>>} = {},
): Promise<Project> {
  await saveProject(projectDir, without(await loadProject(projectDir), 'voice', 'render', 'package'));
  return generate(projectDir, ctx, deps);
}

/** `index` is 0-based (the API); error messages number thumbnails from 1, as users see them. */
export async function chooseThumbnail(
  projectDir: string,
  index: number,
  deps: {renderThumbnail?: RenderThumbnail} = {},
): Promise<Project> {
  const p = await loadProject(projectDir);
  if (!p.thumbnail) throw new Error('No thumbnail yet. Run the package step first');
  if (!Number.isInteger(index) || index < 0 || index >= p.thumbnail.options.length) {
    throw new Error(`Thumbnail ${index + 1} does not exist (choose 1..${p.thumbnail.options.length})`);
  }
  const next = await applyThumbnailChoice(projectDir, p, index, deps);
  await saveProject(projectDir, next);
  return next;
}

/**
 * Forgets the reused YouTube copy (titles, hook, hashtags) and/or the thumbnail options, so the next package run
 * asks the LLM again. Both by default. Removes `package` from done.
 */
export async function refreshYoutube(
  projectDir: string,
  what: {youtube?: boolean; thumbnails?: boolean} = {},
): Promise<Project> {
  const {youtube = true, thumbnails = true} = what;
  const {youtube: yt, thumbnail, ...rest} = await loadProject(projectDir);
  const p = without(
    {...rest, ...(yt && !youtube ? {youtube: yt} : {}), ...(thumbnail && !thumbnails ? {thumbnail} : {})},
    'package',
  );
  await saveProject(projectDir, p);
  return p;
}
