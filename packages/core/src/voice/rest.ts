import {redact} from '../llm/redact.js';
import {ProviderError} from '../llm/types.js';

/** Per-request deadline (headers and body). A scene-length clip returns well within it; worst case per scene is about 3 x 60 s plus 5 s of backoff. */
export const REST_REQUEST_TIMEOUT_MS = 60_000;

export type RestSpec = {
  /** Display name used in errors, e.g. "OpenAI". */
  label: string;
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  secret: string;
};

/** One POST returning audio bytes. Failures become ProviderErrors naming the engine and status, with the key redacted. */
export async function postForAudio(spec: RestSpec, fetchFn: typeof fetch, signal?: AbortSignal): Promise<Uint8Array> {
  const secrets = [spec.secret];
  const timeout = AbortSignal.timeout(REST_REQUEST_TIMEOUT_MS);
  const failed = (cause: unknown) =>
    new ProviderError(redact(`${spec.label} request failed: ${cause instanceof Error ? cause.message : String(cause)}`, secrets), {
      provider: spec.provider,
      transient: true,
    });
  let res: Response;
  try {
    res = await fetchFn(spec.url, {
      method: 'POST',
      headers: {'content-type': 'application/json', ...spec.headers},
      body: JSON.stringify(spec.body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw failed(e);
  }
  if (!res.ok) {
    // redact the whole body before truncating, so a key straddling the cut cannot leak a prefix
    const text = redact(await res.text().catch(() => ''), secrets);
    const detail = text ? `: ${text.slice(0, 300)}` : '';
    throw new ProviderError(redact(`${spec.label} TTS failed with HTTP ${res.status}${detail}`, secrets), {
      provider: spec.provider,
      transient: res.status === 429 || res.status >= 500,
      status: res.status,
    });
  }
  let audio: Uint8Array;
  try {
    audio = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (signal?.aborted) throw e;
    throw failed(e);
  }
  if (audio.length === 0) {
    throw new ProviderError(`${spec.label} TTS returned an empty audio response`, {
      provider: spec.provider,
      transient: false,
    });
  }
  return audio;
}
