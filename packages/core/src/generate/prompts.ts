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
