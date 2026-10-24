import type {ZodType} from 'zod';

export interface LlmProvider {
  generateObject<T>(args: {schema: ZodType<T>; system: string; prompt: string; signal?: AbortSignal}): Promise<T>;
  generateText(args: {system: string; prompt: string; signal?: AbortSignal}): Promise<string>;
  capabilities: {nativeWebSearch: boolean; vision: boolean};
  /** e.g. 'anthropic:claude-sonnet' */
  name: string;
}

/** Thrown when the model's answer still fails validation after all retries. */
export class LlmOutputError extends Error {
  issues: string[];
  raw: string;
  constructor(message: string, issues: string[], raw: string) {
    super(message);
    this.name = 'LlmOutputError';
    this.issues = issues;
    this.raw = raw;
  }
}

export class ProviderError extends Error {
  provider: string;
  transient: boolean;
  status?: number;
  constructor(message: string, opts: {provider: string; transient: boolean; status?: number}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = opts.provider;
    this.transient = opts.transient;
    this.status = opts.status;
  }
}
