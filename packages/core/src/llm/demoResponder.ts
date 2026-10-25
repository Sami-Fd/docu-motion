import {appendFileSync} from 'node:fs';
import {EXAMPLES, SCENE_TYPES} from '@docu-motion/scenes';
import type {ZodType} from 'zod';

/**
 * Offline, deterministic stand-in for an LLM. The fake provider hands over the schema it must satisfy;
 * the schema is recognised by trying candidate outputs against it with `safeParse`, so it keeps working
 * when step code changes (including `ScriptOutputSchema(n)`, which is rebuilt on every call).
 */

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];

const BODY = [
  'we start with the big picture and why this matters to people every single day',
  'the numbers behind this are easier to follow once you see them side by side clearly',
  'a few key figures explain most of what happens here and how the pieces fit together',
  'the trend is steady and it shapes the choices that families and companies make today',
  'comparing the past with the present shows how much has changed over the years',
  'one voice sums it up well and reminds us what the whole system was built to do',
  'the story unfolds over several milestones that built the current situation step by step',
  'a short list of options shows what could be done next and what each choice would cost',
  'the details vary from place to place but the overall direction is clear and consistent',
  'looking ahead the main question is how to balance fairness and cost over the long term',
  'the lesson is simple enough to remember and useful when you read the news about this',
  'to conclude the essential points fit in a few words and they are worth sharing widely',
];

const CLOSER = 'Here is what the story tells us, in plain words and short steps that anyone can follow.';

const topicOf = (prompt: string): string => {
  const m = /^Topic:[ \t]*(.+)$/m.exec(prompt);
  return m ? m[1]!.trim() : 'this topic';
};

const shortTopic = (prompt: string, maxWords = 5): string =>
  topicOf(prompt)
    .split(/\s+/)
    .slice(0, maxWords)
    .join(' ')
    .replace(/[^\p{L}\p{N} '-]/gu, '')
    .trim() || 'this topic';

function factIdsIn(prompt: string): string[] {
  const ids = [...prompt.matchAll(/^(f\d+):/gm)].map((m) => m[1]!);
  return ids.length ? ids : ['f1'];
}

function queries(prompt: string) {
  return {queries: [`${shortTopic(prompt, 8)} key figures`.slice(0, 120)]};
}

function facts(prompt: string) {
  const sources = [...prompt.matchAll(/\[source ([^\]]+)\]\n([\s\S]*?)\n\[end source \1\]/g)].map((m) => ({id: m[1]!, text: m[2]!}));
  const topic = shortTopic(prompt, 8);
  const out = Array.from({length: 5}, (_, i) => {
    const base = {statement: `${topic}: demo fact number ${i + 1}`.slice(0, 200), value: String(i + 1)};
    const src = sources.length ? sources[i % sources.length]! : undefined;
    const excerpt = src ? src.text.trim().slice(0, 120).trim() : '';
    return src && excerpt ? {...base, sourceId: src.id, excerpt} : base;
  });
  return {facts: out};
}

function script(prompt: string, n: number) {
  const ids = factIdsIn(prompt);
  const topic = shortTopic(prompt);
  return {
    scenes: Array.from({length: n}, (_, i) => ({
      narration: `${ORDINALS[i % ORDINALS.length]}, about ${topic}: ${BODY[i % BODY.length]}. ${CLOSER}`,
      factIds: [ids[i % ids.length]!],
    })),
  };
}

function narrationOf(prompt: string): string {
  const m = /^Narration of the scene:\n([\s\S]*?)\n\nFacts used:/m.exec(prompt);
  return (m ? m[1]! : prompt).trim();
}

/** The script above starts each narration with an ordinal, which gives the scene its position. */
function sceneIndex(narration: string): number {
  const first = /^\p{L}+/u.exec(narration)?.[0] ?? '';
  const i = ORDINALS.indexOf(first);
  if (i >= 0) return i;
  let h = 0;
  for (const ch of narration) h = (h * 31 + ch.codePointAt(0)!) % 1_000_003;
  return h;
}

/** Cues must be copied from the narration; use its longer words in order, cycling. */
function withCues<T>(value: T, words: string[]): T {
  let k = 0;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([key, x]) => [key, key === 'cue' && typeof x === 'string' ? words[k++ % words.length]! : walk(x)]),
      );
    }
    return v;
  };
  return walk(value) as T;
}

function scene(prompt: string) {
  const narration = narrationOf(prompt);
  const words = (narration.match(/[\p{L}\p{N}]{4,}/gu) ?? ['demo']).slice(0, 20);
  const type = SCENE_TYPES[sceneIndex(narration) % SCENE_TYPES.length]!;
  return withCues(structuredClone(EXAMPLES[type]), words);
}

/**
 * Test-only hook: when DOCU_MOTION_FAKE_LOG names a file, one line per call (the recognised schema) is appended to it.
 * Read only here and by scripts/make.ts (DOCU_MOTION_FAIL_AT); never set outside tests.
 */
function record(kind: string): void {
  const file = process.env.DOCU_MOTION_FAKE_LOG;
  if (file) appendFileSync(file, `${kind}
`);
}

export function demoResponder(req: {schema: ZodType; system: string; prompt: string}): unknown {
  const {schema, prompt} = req;
  const ok = (v: unknown) => schema.safeParse(v).success;
  const answer = (kind: string, v: unknown) => {
    record(kind);
    return v;
  };

  const sceneSpec = scene(prompt);
  if (/Narration of the scene/.test(prompt) && ok(sceneSpec)) return answer('scene', sceneSpec);

  const q = queries(prompt);
  if (ok(q)) return answer('queries', q);
  const f = facts(prompt);
  if (ok(f)) return answer('facts', f);
  const asked = Number(/exactly (d+) scenes/.exec(prompt)?.[1]);
  const sizes = [...(asked > 0 ? [asked] : []), ...Array.from({length: 40}, (_, i) => i + 1)];
  for (const n of sizes) {
    const s = script(prompt, n);
    if (ok(s)) return answer('script', s);
  }
  if (ok(sceneSpec)) return answer('scene', sceneSpec);
  const probe = {ok: true};
  if (ok(probe)) return answer('probe', probe);
  throw new Error('demoResponder: unrecognised schema');
}
