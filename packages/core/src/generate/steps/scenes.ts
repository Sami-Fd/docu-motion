import {SceneSpecSchema, type SceneSpec} from '@docu-motion/scenes';
import {LlmOutputError} from '../../llm/types.js';
import type {Project} from '../../project/schema.js';
import type {Step, StepContext} from '../context.js';
import {fillScene} from '../prompts.js';
import {cutOnWord} from '../text.js';

const TITLE_MAX = 48;
const SOURCE_MAX = 80;
const FALLBACK_WARNING = 'Scene could not be generated; simple title used';
const UNVERIFIED = 'Unverified figure: ';

type Result = {spec: SceneSpec; status: 'ok' | 'fallback'; warning?: string};

function fallbackTitle(narration: string): string {
  const sentence = narration.split(/[.!?…]/).map((s) => s.trim()).find(Boolean) ?? narration.trim();
  return cutOnWord(sentence, TITLE_MAX) || 'Untitled';
}

/**
 * Sets the source line from the first cited *verified* fact with a resolvable source; drops any
 * LLM-invented one, so an unverified figure never shows "Source: X". Quote scenes never carry a
 * source line (the author is the attribution); title scenes are left untouched.
 */
export function withSourceLine(spec: SceneSpec, p: Project, factIds: string[]): SceneSpec {
  if (spec.type === 'title') return spec;
  if (spec.type === 'quote') {
    if (!('source' in spec)) return spec;
    const {source: _drop, ...rest} = spec;
    return rest as SceneSpec;
  }
  let title: string | undefined;
  for (const id of factIds) {
    const fact = p.facts.find((f) => f.id === id);
    const sid = fact?.verified ? fact.sourceId : undefined;
    const t = sid ? p.sources.find((s) => s.id === sid)?.title.trim() : undefined;
    if (t) {
      title = t;
      break;
    }
  }
  const {source: _drop, ...rest} = spec;
  const source = title ? cutOnWord(title, SOURCE_MAX) : '';
  return (source ? {...rest, source} : rest) as SceneSpec;
}

export async function generateSceneSpec(
  p: Project,
  index: number,
  ctx: StepContext,
  feedback?: string,
): Promise<Result> {
  const scene = p.scenes[index]!;
  const facts = scene.factIds.flatMap((id) => p.facts.filter((f) => f.id === id));
  try {
    const spec = await ctx.llm.generateObject({
      schema: SceneSpecSchema,
      ...fillScene(scene.narration, p.brief.language, facts, feedback),
      signal: ctx.signal,
    });
    return {spec: withSourceLine(spec, p, scene.factIds), status: 'ok'};
  } catch (e) {
    if (!(e instanceof LlmOutputError)) throw e;
    return {
      spec: {type: 'title', title: fallbackTitle(scene.narration), decor: 'none', characters: 0},
      status: 'fallback',
      warning: FALLBACK_WARNING,
    };
  }
}

type Scene = Project['scenes'][number];

/** Applies a generation result to a scene; replaces this step's own warnings, keeps the others. */
export function applySceneResult(scene: Scene, result: Result, p: Project): Scene {
  const warnings = scene.warnings.filter((w) => w !== FALLBACK_WARNING && !w.startsWith(UNVERIFIED));
  if (result.warning) warnings.push(result.warning);
  for (const id of scene.factIds) {
    const f = p.facts.find((x) => x.id === id);
    if (f && !f.verified) warnings.push(`${UNVERIFIED}${f.statement}`);
  }
  return {...scene, spec: withSourceLine(result.spec, p, scene.factIds), status: result.status, warnings};
}

export const scenesStep: Step = async (p, ctx) => {
  const n = p.scenes.length;
  const scenes: Scene[] = [];
  for (let i = 0; i < n; i++) {
    ctx.signal?.throwIfAborted();
    const r = await generateSceneSpec(p, i, ctx);
    scenes.push(applySceneResult(p.scenes[i]!, r, p));
    ctx.onProgress({step: 'scenes', ratio: (i + 1) / n});
  }
  return {...p, scenes};
};
