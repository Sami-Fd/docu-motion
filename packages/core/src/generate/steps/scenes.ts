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

/** Sets the source line from the first cited fact with a resolvable source; drops any LLM-invented one. */
export function withSourceLine(spec: SceneSpec, p: Project, factIds: string[]): SceneSpec {
  if (spec.type === 'title' || spec.type === 'quote') return spec;
  let title: string | undefined;
  for (const id of factIds) {
    const sid = p.facts.find((f) => f.id === id)?.sourceId;
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

export const scenesStep: Step = async (p, ctx) => {
  const n = p.scenes.length;
  const scenes = [];
  for (let i = 0; i < n; i++) {
    ctx.signal?.throwIfAborted();
    const s = p.scenes[i]!;
    const r = await generateSceneSpec(p, i, ctx);
    const warnings = s.warnings.filter((w) => w !== FALLBACK_WARNING && !w.startsWith(UNVERIFIED));
    if (r.warning) warnings.push(r.warning);
    for (const id of s.factIds) {
      const f = p.facts.find((x) => x.id === id);
      if (f && !f.verified) warnings.push(`${UNVERIFIED}${f.statement}`);
    }
    scenes.push({...s, spec: r.spec, status: r.status, warnings});
    ctx.onProgress({step: 'scenes', ratio: (i + 1) / n});
  }
  return {...p, scenes};
};
