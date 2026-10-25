import {EXAMPLES, SCENE_TYPES, type SceneType} from '@docu-motion/scenes';
export type Prompt = {system: string; prompt: string};

export function searchQueries(topic: string, language: string): Prompt {
  return {
    system:
      'You help research a topic for an explainer video. Reply with JSON only. ' +
      `Write the search queries in this language: ${language}.`,
    prompt:
      `Topic: ${topic}\n\n` +
      'Propose 1 to 3 short web search queries (at most 120 characters each) that would find ' +
      'reliable, factual sources about this topic. Return {"queries": ["..."]}.',
  };
}

export function extractFacts(
  topic: string,
  language: string,
  sources: {id: string; text: string}[],
  fromKnowledge: boolean,
): Prompt {
  const system =
    'You extract checkable facts for an explainer video. Reply with JSON only. ' +
    `Write statements and values in this language: ${language}. Excerpts stay in the source's own language.`;
  const shape =
    'Return {"facts": [{"statement": "...", "value": "...", "sourceId": "...", "excerpt": "..."}]} with 3 to 40 facts. ' +
    'Each statement is one short sentence (at most 200 characters). "value" is the key figure or name, if any (at most 40 characters).';
  if (fromKnowledge || sources.length === 0) {
    return {
      system,
      prompt:
        `Topic: ${topic}\n\nNo source text is available. List well-established facts about this topic from your own knowledge. ` +
        'Do not invent figures; omit sourceId and excerpt.\n\n' +
        shape,
    };
  }
  const blocks = sources.map((s) => `[source ${s.id}]\n${s.text}\n[end source ${s.id}]`).join('\n\n');
  return {
    system,
    prompt:
      `Topic: ${topic}\n\nExtract facts about this topic from the sources below. For each fact set "sourceId" to the source id and ` +
      '"excerpt" to a verbatim excerpt copied from that source (at most 400 characters, no rewording, no translation) that supports it. ' +
      'Only use facts the sources state.\n\n' +
      shape +
      `\n\n${blocks}`,
  };
}

export function writeScript(
  topic: string,
  language: string,
  n: number,
  facts: {id: string; statement: string; value?: string}[],
): Prompt {
  const lines = facts.map((f) => `${f.id}: ${f.statement}${f.value ? ` (${f.value})` : ''}`).join('\n');
  return {
    system:
      'You write the narration of a short explainer video. Reply with JSON only. ' +
      `Write all narration in this language: ${language}.`,
    prompt:
      `Topic: ${topic}\n\nWrite exactly ${n} scenes. Return {"scenes": [{"narration": "...", "factIds": ["f1"]}]}.\n` +
      'Rules:\n' +
      '- Each narration is 25 to 45 words.\n' +
      '- Write for speech: short, natural sentences that sound good read aloud, not a written article.\n' +
      '- Round numbers so they are easy to hear (say "about a third", not "33.4 %").\n' +
      '- Do not put scene titles, numbering or headings in the narration.\n' +
      '- "factIds" lists the ids of the facts the scene relies on (at most 6). Use only the ids listed below.\n' +
      '- Build a clear arc: hook, explanation, key figures, conclusion.\n\n' +
      `Facts:\n${lines}`,
  };
}

const LIMITS: Record<SceneType, string> = {
  title: 'title max 48 chars; optional subtitle max 70; decor is "hills", "sea" or "none"; characters is an integer 0 to 6',
  bars: 'title max 48; 2 to 8 bars; label max 18; value >= 0; optional unit max 8',
  donut: 'title max 48; 2 to 6 parts; label max 26; values > 0 and summing to 100 (+-0.5)',
  counter: 'title max 48; value is a number; optional prefix max 4 and suffix max 10; label max 60',
  pictograms: 'title max 48; 1 to 2 groups; label max 24; count is an integer 1 to 12; elderly is a boolean; optional ratio max 8',
  comparison: 'title max 48; left and right each have heading max 24, value max 12, optional caption max 40',
  quote: 'title max 48; text max 180; author max 40',
  timeline: 'title max 48; 3 to 6 events; date max 10; label max 28',
  list: 'title max 48; 2 to 5 items; text max 60; icon is one of coin, drop, sun, cloud, character, none',
};

export function fillScene(
  narration: string,
  language: string,
  facts: {id: string; statement: string; value?: string}[],
  feedback?: string,
): Prompt {
  const lines = facts.map((f) => `${f.id}: ${f.statement}${f.value ? ` (${f.value})` : ''}`).join('\n') || '(none)';
  const types = SCENE_TYPES.map((t) => `- ${t} (${LIMITS[t]}): ${JSON.stringify(EXAMPLES[t])}`).join('\n');
  return {
    system:
      'You design one animated infographic scene for an explainer video. Reply with JSON only. ' +
      `Write all on-screen text in this language: ${language}.`,
    prompt:
      `Narration of the scene:\n${narration}\n\nFacts used:\n${lines}\n\n` +
      'Pick the scene type that best shows what the narration says, and fill it. Return one JSON object whose "type" is one of the types below. ' +
      'Example of each type, with its field limits:\n' +
      `${types}\n\n` +
      'Rules:\n' +
      '- Every "cue" must be a word or short phrase copied exactly from the narration (at most 40 characters); it times the animation.\n' +
      '- Use only figures from the narration and the facts above. Do not invent numbers.\n' +
      '- Do not set a "source" field: the app sets it.\n' +
      '- Respect the field limits; keep texts short.' +
      (feedback ? `\n\nUser feedback to apply:\n${feedback}` : ''),
  };
}
