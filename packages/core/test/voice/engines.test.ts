import {describe, expect, it} from 'vitest';
import {createTtsEngine, defaultVoiceFor, type EdgeClient} from '../../src/voice/engines.js';
import {SettingsSchema} from '../../src/settings/settings.js';
import {ProviderError} from '../../src/llm/types.js';

const settings = (keys: Record<string, string> = {}) => SettingsSchema.parse({keys});
const bytes = new Uint8Array([1, 2, 3]);
const ok = () => new Response(bytes, {status: 200});

const fakeEdge = (voices: {ShortName: string; Locale: string}[] = []): EdgeClient & {calls: string[][]} => {
  const calls: string[][] = [];
  return {
    calls,
    async synthesize(text, voice) {
      calls.push([text, voice]);
      return bytes;
    },
    async listVoices() {
      return voices;
    },
  };
};

describe('ElevenLabs', () => {
  it('sends the right request and returns the bytes', async () => {
    const seen: {url: string; init: RequestInit}[] = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      seen.push({url, init});
      return ok();
    }) as unknown as typeof fetch;
    const e = createTtsEngine('elevenlabs', settings({elevenlabs: 'xi-secret-key'}), {fetch: fetchStub});
    const out = await e.synthesize('Bonjour', {voiceId: 'VOICE1'});
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(seen[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/VOICE1?output_format=mp3_44100_128');
    expect(seen[0]!.init.method).toBe('POST');
    expect((seen[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('xi-secret-key');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({text: 'Bonjour', model_id: 'eleven_multilingual_v2'});
  });
  it('names ELEVENLABS_API_KEY when the key is missing', () => {
    expect(() => createTtsEngine('elevenlabs', settings())).toThrow(/ElevenLabs key missing.*ELEVENLABS_API_KEY/);
    expect(() => createTtsEngine('elevenlabs', settings())).toThrow(ProviderError);
  });
});

describe('OpenAI', () => {
  it('sends the right request', async () => {
    const seen: {url: string; init: RequestInit}[] = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      seen.push({url, init});
      return ok();
    }) as unknown as typeof fetch;
    const e = createTtsEngine('openai', settings({openai: 'sk-openai-key'}), {fetch: fetchStub});
    await e.synthesize('Hi', {voiceId: 'alloy'});
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/audio/speech');
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-openai-key');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: 'Hi',
      response_format: 'mp3',
    });
  });
  it('redacts the key in a 401 error and names engine and status', async () => {
    const key = 'sk-very-secret-123';
    const fetchStub = (async () =>
      new Response(`Incorrect API key provided: ${key}`, {status: 401})) as unknown as typeof fetch;
    const e = createTtsEngine('openai', settings({openai: key}), {fetch: fetchStub});
    const err = (await e.synthesize('x', {voiceId: 'alloy'}).catch((x) => x)) as Error;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('OpenAI');
    expect(err.message).toContain('401');
    expect(err.message).not.toContain(key);
  });
  it('names OPENAI_API_KEY when the key is missing', () => {
    expect(() => createTtsEngine('openai', settings())).toThrow(/OpenAI key missing.*OPENAI_API_KEY/);
  });
});

describe('transient retry', () => {
  it('retries a 429 twice with backoff 1 s then 4 s', async () => {
    let n = 0;
    const fetchStub = (async () => (++n <= 2 ? new Response('slow down', {status: 429}) : ok())) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const e = createTtsEngine('openai', settings({openai: 'sk-abcdefgh'}), {
      fetch: fetchStub,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(Array.from(await e.synthesize('x', {voiceId: 'alloy'}))).toEqual([1, 2, 3]);
    expect(sleeps).toEqual([1000, 4000]);
  });
  it('gives up after two retries', async () => {
    let n = 0;
    const fetchStub = (async () => (n++, new Response('boom', {status: 503}))) as unknown as typeof fetch;
    const e = createTtsEngine('openai', settings({openai: 'sk-abcdefgh'}), {fetch: fetchStub, sleep: async () => {}});
    await expect(e.synthesize('x', {voiceId: 'alloy'})).rejects.toThrow(/OpenAI.*503/);
    expect(n).toBe(3);
  });
  it('does not retry a 400', async () => {
    let n = 0;
    const fetchStub = (async () => (n++, new Response('bad', {status: 400}))) as unknown as typeof fetch;
    const e = createTtsEngine('openai', settings({openai: 'sk-abcdefgh'}), {fetch: fetchStub, sleep: async () => {}});
    await expect(e.synthesize('x', {voiceId: 'alloy'})).rejects.toThrow(/400/);
    expect(n).toBe(1);
  });
  it('retries network errors and redacts them', async () => {
    let n = 0;
    const key = 'sk-abcdefgh-net';
    const fetchStub = (async () => {
      if (++n === 1) throw new TypeError(`fetch failed for ${key}`);
      return ok();
    }) as unknown as typeof fetch;
    const e = createTtsEngine('openai', settings({openai: key}), {fetch: fetchStub, sleep: async () => {}});
    expect(await e.synthesize('x', {voiceId: 'alloy'})).toEqual(bytes);
    expect(n).toBe(2);
    const bad = (async () => {
      throw new TypeError(`fetch failed for ${key}`);
    }) as unknown as typeof fetch;
    const e2 = createTtsEngine('openai', settings({openai: key}), {fetch: bad, sleep: async () => {}});
    const err = (await e2.synthesize('x', {voiceId: 'alloy'}).catch((x) => x)) as Error;
    expect(err.message).toContain('OpenAI');
    expect(err.message).not.toContain(key);
  });
});

describe('Edge', () => {
  it('delegates to the injected client with no key needed', async () => {
    const client = fakeEdge();
    const e = createTtsEngine('edge', settings(), {edgeClient: client});
    expect(e.name).toBe('edge');
    expect(await e.synthesize('Salut', {voiceId: 'fr-FR-DeniseNeural'})).toEqual(bytes);
    expect(client.calls).toEqual([['Salut', 'fr-FR-DeniseNeural']]);
  });
  it('wraps client failures in a ProviderError naming Edge', async () => {
    const client: EdgeClient = {
      async synthesize() {
        throw new Error('ws closed');
      },
      async listVoices() {
        return [];
      },
    };
    const e = createTtsEngine('edge', settings(), {edgeClient: client, sleep: async () => {}});
    const err = (await e.synthesize('x', {voiceId: 'v'}).catch((x) => x)) as Error;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(/Edge.*ws closed/);
  });
});

describe('defaultVoiceFor', () => {
  it('maps known edge languages without listing voices', async () => {
    const client = fakeEdge();
    expect(await defaultVoiceFor('edge', 'fr', {edgeClient: client})).toBe('fr-FR-DeniseNeural');
    expect(await defaultVoiceFor('edge', 'pt', {edgeClient: client})).toBe('pt-BR-FranciscaNeural');
  });
  it('picks the first matching voice for other languages', async () => {
    const client = fakeEdge([
      {ShortName: 'de-DE-KatjaNeural', Locale: 'de-DE'},
      {ShortName: 'nl-BE-ArnaudNeural', Locale: 'nl-BE'},
      {ShortName: 'nl-NL-ColetteNeural', Locale: 'nl-NL'},
    ]);
    expect(await defaultVoiceFor('edge', 'nl', {edgeClient: client})).toBe('nl-BE-ArnaudNeural');
  });
  it('throws when no edge voice matches', async () => {
    await expect(defaultVoiceFor('edge', 'xx', {edgeClient: fakeEdge()})).rejects.toThrow(/xx/);
  });
  it('has fixed defaults for the other engines', async () => {
    expect(await defaultVoiceFor('elevenlabs', 'fr', {})).toBe('21m00Tcm4TlvDq8ikWAM');
    expect(await defaultVoiceFor('openai', 'fr', {})).toBe('alloy');
  });
});
