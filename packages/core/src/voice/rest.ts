import {redact} from '../llm/redact.js';
import {ProviderError} from '../llm/types.js';

const REQUEST_TIMEOUT_MS = 60_000;

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
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
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
    const cause = e instanceof Error ? e.message : String(e);
    throw new ProviderError(redact(`${spec.label} request failed: ${cause}`, secrets), {
      provider: spec.provider,
      transient: true,
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = text ? `: ${text.slice(0, 300)}` : '';
    throw new ProviderError(redact(`${spec.label} TTS failed with HTTP ${res.status}${detail}`, secrets), {
      provider: spec.provider,
      transient: res.status === 429 || res.status >= 500,
      status: res.status,
    });
  }
  return new Uint8Array(await res.arrayBuffer());
}
