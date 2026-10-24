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
