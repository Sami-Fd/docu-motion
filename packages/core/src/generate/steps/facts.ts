import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {excerptFound} from '../../research/verify.js';
import type {Step} from '../context.js';
import {extractFacts} from '../prompts.js';

const MAX_PER_SOURCE = 12_000;
const MAX_TOTAL = 60_000;
/** Not worth sending a source with less room than this. */
const MIN_USEFUL = 200;

export const FactsOutputSchema = z.object({
  facts: z
    .array(
      z.object({
        statement: z.string().min(1).max(200),
        value: z.string().max(40).optional(),
        sourceId: z.string().optional(),
        excerpt: z.string().max(400).optional(),
      }),
    )
    .min(3)
    .max(40),
});

/** Cut to at most `max` characters, backing up to a whitespace boundary when a word would be split. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max;
  if (!/\s/.test(text.charAt(max))) {
    const ws = text.slice(0, max).search(/\s\S*$/);
    if (ws > 0) cut = ws;
  }
  return text.slice(0, cut).trimEnd();
}

export const factsStep: Step = async (p, ctx) => {
  ctx.signal?.throwIfAborted();
  const usable: {id: string; text: string}[] = [];
  let budget = MAX_TOTAL;
  for (const s of p.sources) {
    if (s.error || budget < MIN_USEFUL) continue;
    const file = path.join(ctx.projectDir, s.textPath);
    if (!existsSync(file)) continue;
    const full = readFileSync(file, 'utf8').trim();
    if (!full) continue;
    const text = truncate(truncate(full, MAX_PER_SOURCE), budget);
    if (!text) continue;
    budget -= text.length;
    usable.push({id: s.id, text});
  }
  const fromKnowledge = usable.length === 0;
  const out = await ctx.llm.generateObject({
    schema: FactsOutputSchema,
    ...extractFacts(p.brief.topic, p.brief.language, usable, fromKnowledge),
    signal: ctx.signal,
  });
  const byId = new Map(usable.map((s) => [s.id, s.text]));
  const facts = out.facts.map((f, i) => {
    const sourceText = !fromKnowledge && f.sourceId ? byId.get(f.sourceId) : undefined;
    // A citation that does not resolve to a source we sent is dropped, not stored.
    if (sourceText === undefined) return {id: `f${i + 1}`, statement: f.statement, value: f.value, verified: false};
    const verified = !!f.excerpt && excerptFound(f.excerpt, sourceText);
    return {id: `f${i + 1}`, statement: f.statement, value: f.value, sourceId: f.sourceId, excerpt: f.excerpt, verified};
  });
  ctx.onProgress({step: 'facts', log: `${facts.length} facts (${facts.filter((f) => f.verified).length} verified)`});
  return {...p, facts};
};
