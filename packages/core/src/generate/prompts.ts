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
