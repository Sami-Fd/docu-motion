import {MsEdgeTTS, OUTPUT_FORMAT} from 'msedge-tts';

export type EdgeClient = {
  synthesize(text: string, voice: string, signal?: AbortSignal): Promise<Uint8Array>;
  listVoices(): Promise<{ShortName: string; Locale: string}[]>;
};

/** Real client over msedge-tts (Microsoft Edge read-aloud service; no key). One connection per call, since the voice is per call. */
export function createEdgeClient(): EdgeClient {
  return {
    async synthesize(text, voice, signal) {
      if (signal?.aborted) throw abortError();
      const tts = new MsEdgeTTS();
      try {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const {audioStream} = tts.toStream(text);
        const chunks: Buffer[] = [];
        return await new Promise<Uint8Array>((resolve, reject) => {
          const onAbort = () => {
            audioStream.destroy();
            reject(abortError());
          };
          signal?.addEventListener('abort', onAbort, {once: true});
          const done = () => signal?.removeEventListener('abort', onAbort);
          audioStream.on('data', (c: Buffer) => chunks.push(c));
          audioStream.on('error', (e) => {
            done();
            reject(e);
          });
          audioStream.on('close', () => {
            done();
            const out = new Uint8Array(Buffer.concat(chunks));
            if (out.length === 0) reject(new Error('Edge TTS returned no audio'));
            else resolve(out);
          });
        });
      } finally {
        tts.close();
      }
    },
    async listVoices() {
      const tts = new MsEdgeTTS();
      try {
        return await tts.getVoices();
      } finally {
        tts.close();
      }
    },
  };
}

function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}
