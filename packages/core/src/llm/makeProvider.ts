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

  const scrub = (e: unknown): unknown => {
    if (e instanceof Error) {
      e.message = redact(e.message, secrets);
      if (e instanceof LlmOutputError) {
        e.raw = redact(e.raw, secrets);
        e.issues = e.issues.map((i) => redact(i, secrets));
      }
    }
    return e;
  };

  async function withTransientRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const retriable =
          e instanceof ProviderError && e.transient && attempt < TRANSIENT_BACKOFF_MS.length && !signal?.aborted;
        if (!retriable) throw scrub(e);
        await sleep(TRANSIENT_BACKOFF_MS[attempt]!);
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
