import {zodSchema} from 'ai';
import type {ZodType} from 'zod';
import {extractJson} from './json.js';
import {redact} from './redact.js';
import {LlmOutputError, ProviderError, type LlmProvider} from './types.js';

export type RawProvider = {
  name: string;
  capabilities: LlmProvider['capabilities'];
  /** Returns parsed JSON or raw text. */
  object(args: {
    jsonSchema: object;
    schemaName: string;
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  text(args: {system: string; prompt: string; signal?: AbortSignal}): Promise<string>;
};

export type MakeProviderOpts = {
  sleep?: (ms: number) => Promise<void>;
  /** Secrets to scrub from the messages of rethrown errors. */
  secrets?: string[];
};

const VALIDATION_RETRIES = 3;
const TRANSIENT_BACKOFF_MS = [1000, 4000];
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function makeProvider(raw: RawProvider, opts: MakeProviderOpts = {}): LlmProvider {
  const sleep = opts.sleep ?? defaultSleep;
  const secrets = opts.secrets ?? [];

  const scrubText = (t: string | undefined) => (t === undefined ? t : redact(t, secrets));

  const scrubCause = (e: unknown, depth = 0): unknown => {
    if (!(e instanceof Error)) return e === undefined ? undefined : redact(String(e), secrets);
    e.message = redact(e.message, secrets);
    e.stack = scrubText(e.stack);
    if (depth < 5 && 'cause' in e) (e as {cause?: unknown}).cause = scrubCause((e as {cause?: unknown}).cause, depth + 1);
    return e;
  };

  const scrub = (e: unknown): unknown => {
    if (e instanceof Error && e.name === 'AbortError') return e;
    if (e instanceof LlmOutputError) {
      scrubCause(e);
      e.raw = redact(e.raw, secrets);
      e.issues = e.issues.map((i) => redact(i, secrets));
      return e;
    }
    if (e instanceof ProviderError) {
      scrubCause(e);
      return e;
    }
    // Unknown throwable: keep only safe information (message, status, transient flag), drop extra fields.
    const obj = (e ?? {}) as {message?: unknown; status?: unknown; statusCode?: unknown; stack?: unknown};
    const status = typeof obj.status === 'number' ? obj.status : typeof obj.statusCode === 'number' ? obj.statusCode : undefined;
    const message = e instanceof Error ? e.message : typeof e === 'string' ? e : String(obj.message ?? 'Unknown provider error');
    const wrapped = new ProviderError(redact(message, secrets), {
      provider: raw.name,
      transient: false,
      status,
    });
    wrapped.stack = e instanceof Error ? scrubText(e.stack) : wrapped.stack;
    return wrapped;
  };

  const abortError = () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  };

  const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> => {
    if (!signal) return sleep(ms);
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, {once: true});
      sleep(ms).then(
        () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  };

  async function withTransientRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      try {
        return await fn();
      } catch (e) {
        const retriable =
          e instanceof ProviderError && e.transient && attempt < TRANSIENT_BACKOFF_MS.length && !signal?.aborted;
        if (!retriable) throw scrub(e);
        await abortableSleep(TRANSIENT_BACKOFF_MS[attempt]!, signal);
        if (signal?.aborted) throw abortError();
      }
    }
  }

  return {
    name: raw.name,
    capabilities: raw.capabilities,
    generateText: (args) => withTransientRetry(() => raw.text(args), args.signal),
    async generateObject<T>(args: {schema: ZodType<T>; system: string; prompt: string; signal?: AbortSignal}) {
      const jsonSchema = zodSchema(args.schema).jsonSchema;
      let prompt = args.prompt;
      let issues: string[] = [];
      let lastRaw = '';
      for (let attempt = 0; attempt <= VALIDATION_RETRIES; attempt++) {
        if (args.signal?.aborted) throw abortError();
        const result = await withTransientRetry(
          () => raw.object({jsonSchema, schemaName: 'result', system: args.system, prompt, signal: args.signal}),
          args.signal,
        );
        lastRaw = typeof result === 'string' ? result : (JSON.stringify(result) ?? '');
        const value = typeof result === 'string' ? extractJson(result) : result;
        if (value === undefined) {
          issues = ['(root): no JSON object found in the answer'];
        } else {
          const parsed = args.schema.safeParse(value);
          if (parsed.success) return parsed.data;
          issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
        }
        prompt = `${args.prompt}\n\nYour previous answer was invalid:\n${issues.map((i) => `- ${i}`).join('\n')}\nReturn only corrected JSON.`;
      }
      throw scrub(
        new LlmOutputError(
          `Model output still invalid after ${VALIDATION_RETRIES} retries:\n${issues.map((i) => `- ${i}`).join('\n')}`,
          issues,
          lastRaw,
        ),
      );
    },
  };
}
