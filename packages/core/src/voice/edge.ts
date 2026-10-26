import {MsEdgeTTS, OUTPUT_FORMAT} from 'msedge-tts';

export type EdgeClient = {
  synthesize(text: string, voice: string, signal?: AbortSignal): Promise<Uint8Array>;
  listVoices(): Promise<{ShortName: string; Locale: string}[]>;
};

/** Thrown by the real client; `transient` is false for errors a retry cannot fix (bad voice, empty audio). */
export class EdgeClientError extends Error {
  transient: boolean;
  constructor(message: string, transient: boolean) {
    super(message);
    this.name = 'EdgeClientError';
    this.transient = transient;
  }
}

/** msedge-tts puts the text raw into SSML, so markup characters in a narration must be escaped. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Listing voices has no built-in timeout; offline it would hang forever. */
export const LIST_VOICES_TIMEOUT_MS = 15_000;

/** Real client over msedge-tts (Microsoft Edge read-aloud service; no key). One connection per call, since the voice is per call. */
export function createEdgeClient(): EdgeClient {
  return {
    async synthesize(text, voice, signal) {
      if (signal?.aborted) throw abortError();
      const tts = new MsEdgeTTS();
      try {
        try {
          await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        } catch (e) {
          // an unusable voice id throws synchronously-ish; a connection failure is worth retrying
          const msg = e instanceof Error ? e.message : String(e);
          throw new EdgeClientError(msg, !/locale|voice/i.test(msg));
        }
        if (signal?.aborted) throw abortError();
        const {audioStream} = tts.toStream(escapeXml(text));
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
            if (out.length === 0) reject(new EdgeClientError('Edge TTS returned no audio', false));
            else resolve(out);
          });
        });
      } finally {
        tts.close();
      }
    },
    async listVoices() {
      const tts = new MsEdgeTTS();
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new EdgeClientError('Listing Edge voices timed out', true)),
            LIST_VOICES_TIMEOUT_MS,
          );
          timer.unref();
        });
        return await Promise.race([tts.getVoices(), timeout]);
      } finally {
        clearTimeout(timer);
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
