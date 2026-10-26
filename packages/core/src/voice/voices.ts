import {createEdgeClient, type EdgeClient} from './edge.js';

const EDGE_DEFAULTS: Record<string, string> = {
  fr: 'fr-FR-DeniseNeural',
  en: 'en-US-AriaNeural',
  es: 'es-ES-ElviraNeural',
  de: 'de-DE-KatjaNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
};

export const ELEVENLABS_DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel (multilingual)
export const OPENAI_DEFAULT_VOICE = 'alloy';

/** Default voice for an engine and language. Edge: a fixed table, else the first listed voice for the language. */
export async function defaultVoiceFor(
  engine: 'edge' | 'elevenlabs' | 'openai',
  language: string,
  deps: {edgeClient?: EdgeClient} = {},
): Promise<string> {
  if (engine === 'elevenlabs') return ELEVENLABS_DEFAULT_VOICE;
  if (engine === 'openai') return OPENAI_DEFAULT_VOICE;
  // accept region-tagged input such as "en-GB" or "pt_BR"
  const lang = language.toLowerCase().split(/[-_]/)[0]!;
  const known = EDGE_DEFAULTS[lang];
  if (known) return known;
  const voices = await (deps.edgeClient ?? createEdgeClient()).listVoices();
  const found = voices.find((v) => v.Locale.startsWith(`${lang}-`));
  if (!found) throw new Error(`No Edge voice found for language "${lang}" — pass a voice id`);
  return found.ShortName;
}
