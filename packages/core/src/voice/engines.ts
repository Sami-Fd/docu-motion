import {withTransientRetry} from '../llm/makeProvider.js';
import {redact} from '../llm/redact.js';
import {ProviderError} from '../llm/types.js';
import type {Settings} from '../settings/settings.js';
import {createEdgeClient, type EdgeClient} from './edge.js';
import {postForAudio} from './rest.js';

export type {EdgeClient} from './edge.js';
export {defaultVoiceFor} from './voices.js';

export type TtsEngineName = 'edge' | 'elevenlabs' | 'openai';

export type TtsEngine = {
  name: TtsEngineName;
  /** Returns MP3 bytes. */
  synthesize(text: string, opts: {voiceId: string; signal?: AbortSignal}): Promise<Uint8Array>;
};

export type TtsDeps = {
  fetch?: typeof fetch;
  edgeClient?: EdgeClient;
  sleep?: (ms: number) => Promise<void>;
};

export function createTtsEngine(engine: TtsEngineName, settings: Settings, deps: TtsDeps = {}): TtsEngine {
  const fetchFn = deps.fetch ?? fetch;
  const retry = <T>(fn: () => Promise<T>, signal: AbortSignal | undefined, secrets: string[]) =>
    withTransientRetry(fn, {
      sleep: deps.sleep,
      signal,
      scrub: (e) => {
        if (e instanceof ProviderError) e.message = redact(e.message, secrets);
        return e;
      },
    });

  if (engine === 'edge') {
    const client = deps.edgeClient ?? createEdgeClient();
    return {
      name: 'edge',
      synthesize: (text, {voiceId, signal}) =>
        retry(
          async () => {
            try {
              return await client.synthesize(text, voiceId, signal);
            } catch (e) {
              if (signal?.aborted) throw e;
              const cause = e instanceof Error ? e.message : String(e);
              throw new ProviderError(`Edge TTS failed: ${cause}`, {provider: 'edge', transient: true});
            }
          },
          signal,
          [],
        ),
    };
  }

  if (engine === 'elevenlabs') {
    const key = settings.keys.elevenlabs;
    if (!key) {
      throw new ProviderError('ElevenLabs key missing — add it in Settings or ELEVENLABS_API_KEY', {
        provider: 'elevenlabs',
        transient: false,
      });
    }
    return {
      name: 'elevenlabs',
      synthesize: (text, {voiceId, signal}) =>
        retry(
          () =>
            postForAudio(
              {
                label: 'ElevenLabs',
                provider: 'elevenlabs',
                url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
                headers: {'xi-api-key': key},
                body: {text, model_id: 'eleven_multilingual_v2'},
                secret: key,
              },
              fetchFn,
              signal,
            ),
          signal,
          [key],
        ),
    };
  }

  const key = settings.keys.openai;
  if (!key) {
    throw new ProviderError('OpenAI key missing — add it in Settings or OPENAI_API_KEY', {
      provider: 'openai',
      transient: false,
    });
  }
  return {
    name: 'openai',
    synthesize: (text, {voiceId, signal}) =>
      retry(
        () =>
          postForAudio(
            {
              label: 'OpenAI',
              provider: 'openai',
              url: 'https://api.openai.com/v1/audio/speech',
              headers: {Authorization: `Bearer ${key}`},
              body: {model: 'gpt-4o-mini-tts', voice: voiceId, input: text, response_format: 'mp3'},
              secret: key,
            },
            fetchFn,
            signal,
          ),
        signal,
        [key],
      ),
  };
}
