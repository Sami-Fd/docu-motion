import {Readable} from 'node:stream';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  texts: [] as string[],
  setMetadata: async (_v: string): Promise<void> => {},
  stream: () => null as unknown as Readable,
  getVoices: async (): Promise<unknown[]> => [],
}));

vi.mock('msedge-tts', () => ({
  OUTPUT_FORMAT: {AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'mp3'},
  MsEdgeTTS: class {
    setMetadata(v: string) {
      return state.setMetadata(v);
    }
    toStream(text: string) {
      state.texts.push(text);
      return {audioStream: state.stream()};
    }
    getVoices() {
      return state.getVoices();
    }
    close() {}
  },
}));

import {createEdgeClient, EdgeClientError, escapeXml, LIST_VOICES_TIMEOUT_MS} from '../../src/voice/edge.js';

const audio = () => Readable.from([Buffer.from([1, 2]), Buffer.from([3])]);

beforeEach(() => {
  state.texts = [];
  state.setMetadata = async () => {};
  state.stream = audio;
  state.getVoices = async () => [];
});

describe('escapeXml', () => {
  it('escapes the five markup characters', () => {
    expect(escapeXml(`R&D x < y > "z" 'w'`)).toBe('R&amp;D x &lt; y &gt; &quot;z&quot; &apos;w&apos;');
  });
});

describe('createEdgeClient', () => {
  it('escapes the narration before it reaches msedge-tts and returns the bytes', async () => {
    const out = await createEdgeClient().synthesize('R&D x < y', 'fr-FR-DeniseNeural');
    expect(state.texts).toEqual(['R&amp;D x &lt; y']);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
  it('rejects a pre-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(createEdgeClient().synthesize('x', 'v', ac.signal)).rejects.toMatchObject({name: 'AbortError'});
    expect(state.texts).toEqual([]);
  });
  it('stops when aborted while connecting', async () => {
    const ac = new AbortController();
    state.setMetadata = async () => ac.abort();
    await expect(createEdgeClient().synthesize('x', 'v', ac.signal)).rejects.toMatchObject({name: 'AbortError'});
    expect(state.texts).toEqual([]);
  });
  it('treats empty audio as a non-transient error', async () => {
    state.stream = () => Readable.from([]);
    const err = (await createEdgeClient().synthesize('x', 'v').catch((e) => e)) as EdgeClientError;
    expect(err).toBeInstanceOf(EdgeClientError);
    expect(err.transient).toBe(false);
  });
  it('treats an unusable voice as non-transient and a connection failure as transient', async () => {
    state.setMetadata = async () => {
      throw new Error('Could not infer voiceLocale from voiceName');
    };
    expect(((await createEdgeClient().synthesize('x', 'zz').catch((e) => e)) as EdgeClientError).transient).toBe(false);
    state.setMetadata = async () => {
      throw new Error('socket hang up');
    };
    expect(((await createEdgeClient().synthesize('x', 'v').catch((e) => e)) as EdgeClientError).transient).toBe(true);
  });
  it('propagates stream errors', async () => {
    state.stream = () =>
      new Readable({
        read() {
          this.destroy(new Error('ws closed'));
        },
      });
    await expect(createEdgeClient().synthesize('x', 'v')).rejects.toThrow('ws closed');
  });
  it('times out listVoices', async () => {
    vi.useFakeTimers();
    try {
      state.getVoices = () => new Promise(() => {});
      const assertion = expect(createEdgeClient().listVoices()).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(LIST_VOICES_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
