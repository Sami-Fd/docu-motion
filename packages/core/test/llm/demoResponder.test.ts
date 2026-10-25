import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {SceneSpecSchema, SCENE_TYPES} from '@docu-motion/scenes';
import {QueriesSchema} from '../../src/generate/steps/sources.js';
import {FactsOutputSchema} from '../../src/generate/steps/facts.js';
import {ScriptOutputSchema} from '../../src/generate/steps/script.js';
import {extractFacts, fillScene, searchQueries, writeScript} from '../../src/generate/prompts.js';
import {demoResponder} from '../../src/llm/demoResponder.js';
import {createFakeProvider} from '../../src/llm/fake.js';

const llm = createFakeProvider(demoResponder);
const facts = [
  {id: 'f1', statement: 'A'},
  {id: 'f2', statement: 'B'},
  {id: 'f3', statement: 'C'},
];

describe('demoResponder', () => {
  it('answers the queries schema', async () => {
    const r = await llm.generateObject({
      schema: QueriesSchema,
      ...searchQueries('Topic X', 'en'),
    });
    expect(r.queries.length).toBeGreaterThan(0);
  });

  it('answers facts, with verbatim excerpts when sources exist', async () => {
    const a = await llm.generateObject({schema: FactsOutputSchema, ...extractFacts('T', 'en', [], true)});
    expect(a.facts.length).toBeGreaterThanOrEqual(3);
    const text = 'Alpha is one. Beta is two. Gamma is three.';
    const b = await llm.generateObject({schema: FactsOutputSchema, ...extractFacts('T', 'en', [{id: 's1', text}], false)});
    expect(b.facts.every((f) => f.sourceId === 's1' && text.includes(f.excerpt!))).toBe(true);
  });

  it('answers the script schema for any requested n, citing existing facts', async () => {
    for (const n of [8, 11, 12]) {
      const r = await llm.generateObject({schema: ScriptOutputSchema(n), ...writeScript('Topic X', 'en', n, facts)});
      expect(r.scenes).toHaveLength(n);
      expect(r.scenes.every((s) => s.factIds.every((id) => ['f1', 'f2', 'f3'].includes(id)))).toBe(true);
    }
    // recognised from the schema alone when the prompt does not state n
    const r = await llm.generateObject({schema: ScriptOutputSchema(11), system: '', prompt: 'x'});
    expect(r.scenes).toHaveLength(11);
  });

  it('honours "exactly N scenes" from the prompt when the schema accepts a range', async () => {
    const range = z.object({scenes: z.array(z.object({narration: z.string(), factIds: z.array(z.string())})).min(1).max(20)});
    const r = await llm.generateObject({schema: range, system: '', prompt: 'Write exactly 11 scenes about Topic X.\nf1: A'});
    expect(r.scenes).toHaveLength(11);
  });

  it('cycles scene types in order with cues taken from the narration', async () => {
    const script = await llm.generateObject({schema: ScriptOutputSchema(10), ...writeScript('Topic X', 'en', 10, facts)});
    const types: string[] = [];
    for (const s of script.scenes) {
      const spec = await llm.generateObject({schema: SceneSpecSchema, ...fillScene(s.narration, 'en', [])});
      types.push(spec.type);
      for (const m of JSON.stringify(spec).matchAll(/"cue":"([^"]+)"/g)) expect(s.narration).toContain(m[1]);
    }
    expect(types.slice(0, 9)).toEqual([...SCENE_TYPES]);
    expect(types[9]).toBe('title');
  });

  it('is deterministic and answers the connection test', async () => {
    const p = writeScript('Topic X', 'en', 8, facts);
    const a = await llm.generateObject({schema: ScriptOutputSchema(8), ...p});
    const b = await llm.generateObject({schema: ScriptOutputSchema(8), ...p});
    expect(a).toEqual(b);
    expect(await llm.generateObject({schema: z.object({ok: z.literal(true)}), system: '', prompt: ''})).toEqual({ok: true});
  });
});
