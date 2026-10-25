import {estimateDurationFrames} from '@docu-motion/scenes';
import {z} from 'zod';
import type {Step} from '../context.js';
import {writeScript} from '../prompts.js';
import {cutOnWord} from '../text.js';

const MIN_WORDS = 25;
const MAX_WORDS = 45;
const TITLE_MAX = 48;

export const sceneCount = (targetMinutes: number): number =>
  Math.min(12, Math.max(8, Math.round((targetMinutes * 60) / 16)));

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export const ScriptOutputSchema = (n: number) =>
  z
    .object({
      scenes: z.array(z.object({narration: z.string(), factIds: z.array(z.string()).max(6)})).length(n),
    })
    .superRefine((v, ctx) => {
      v.scenes.forEach((s, i) => {
        const w = wordCount(s.narration);
        if (w < MIN_WORDS || w > MAX_WORDS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['scenes', i, 'narration'],
            message: `Narration has ${w} words; it must have ${MIN_WORDS} to ${MAX_WORDS} words`,
          });
        }
      });
    });

/** First 48 characters of the topic, cut on a word boundary; never empty. */
function placeholderTitle(topic: string): string {
  return cutOnWord(topic, TITLE_MAX) || 'Untitled';
}

export const scriptStep: Step = async (p, ctx) => {
  ctx.signal?.throwIfAborted();
  const n = sceneCount(p.brief.targetMinutes);
  const out = await ctx.llm.generateObject({
    schema: ScriptOutputSchema(n),
    ...writeScript(p.brief.topic, p.brief.language, n, p.facts),
    signal: ctx.signal,
  });
  const known = new Set(p.facts.map((f) => f.id));
  const title = placeholderTitle(p.brief.topic);
  const scenes = out.scenes.map((s, i) => ({
    id: `s${String(i + 1).padStart(2, '0')}`,
    narration: s.narration,
    spec: {type: 'title' as const, title, decor: 'none' as const, characters: 0},
    status: 'ok' as const,
    durationFrames: estimateDurationFrames(s.narration),
    factIds: [...new Set(s.factIds.filter((id) => known.has(id)))],
    warnings: [] as string[],
  }));
  ctx.onProgress({step: 'script', log: `${scenes.length} scenes`});
  return {...p, scenes};
};
