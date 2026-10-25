import {createAnthropic} from '@ai-sdk/anthropic';
import {createGoogle} from '@ai-sdk/google';
import {createMistral} from '@ai-sdk/mistral';
import {createOpenAI} from '@ai-sdk/openai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {createOpenRouter} from '@openrouter/ai-sdk-provider';
import {
  APICallError,
  generateText,
  jsonSchema,
  JSONParseError,
  NoObjectGeneratedError,
  Output,
  TypeValidationError,
  type LanguageModel,
} from 'ai';
import type {ProviderRef} from '../project/schema.js';
import type {Settings} from '../settings/settings.js';
import {makeProvider} from './makeProvider.js';
import {redact} from './redact.js';
import {ProviderError, type LlmProvider} from './types.js';

export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5.1',
  google: 'gemini-2.5-flash',
  mistral: 'mistral-large-latest',
  openrouter: 'anthropic/claude-sonnet-5-5',
  ollama: 'qwen3:14b',
};

const LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};

const ENV_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const NATIVE_WEB_SEARCH = new Set(['anthropic', 'openai', 'google']);
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function errorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const code = (cur as {code?: unknown}).code;
    if (typeof code === 'string') return code;
    cur = (cur as {cause?: unknown}).cause;
  }
  return undefined;
}

export function toProviderError(e: unknown, provider: string, secrets: string[]): unknown {
  if (e instanceof ProviderError) return e;
  if (e instanceof Error && e.name === 'AbortError') return e;
  if (APICallError.isInstance(e)) {
    const status = e.statusCode;
    const transient = status === 429 || status === 408 || (status !== undefined && status >= 500) ||
      (status === undefined && (e.isRetryable || (errorCode(e) !== undefined && TRANSIENT_CODES.has(errorCode(e)!))));
    const label = LABELS[provider] ?? provider;
    const hint = (status === 401 || status === 403) && ENV_VARS[provider]
      ? ` — check the key in Settings or ${ENV_VARS[provider]}`
      : '';
    const head = status !== undefined ? `${label} API error (HTTP ${status})` : `${label} API error`;
    return new ProviderError(redact(`${head}: ${e.message}${hint}`, secrets), {provider, transient, status});
  }
  const message = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : '';
  const code = errorCode(e);
  const transient =
    name === 'TimeoutError' ||
    (code !== undefined && TRANSIENT_CODES.has(code)) ||
    (e instanceof TypeError && /fetch failed/i.test(message));
  return new ProviderError(redact(message, secrets), {provider, transient});
}

export function buildModel(provider: string, modelId: string, settings: Settings): LanguageModel {
  const keys = settings.keys;
  switch (provider) {
    case 'anthropic':
      return createAnthropic({apiKey: keys.anthropic})(modelId);
    case 'openai':
      return createOpenAI({apiKey: keys.openai})(modelId);
    case 'google':
      return createGoogle({apiKey: keys.google})(modelId);
    case 'mistral':
      return createMistral({apiKey: keys.mistral})(modelId);
    case 'openrouter':
      // OpenRouter defaults json_schema.strict to true, which rejects optional properties and a root anyOf.
      return createOpenRouter({apiKey: keys.openrouter}).chat(modelId, {structuredOutputs: {strict: false}});
    case 'ollama':
      return createOpenAICompatible({name: 'ollama', baseURL: settings.ollamaBaseUrl})(modelId);
    default:
      throw new Error(`Unknown API provider "${provider}"`);
  }
}

export function createApiProvider(
  ref: ProviderRef,
  settings: Settings,
  deps: {languageModel?: LanguageModel; sleep?: (ms: number) => Promise<void>} = {},
): LlmProvider {
  const provider = ref.provider;
  if (!(provider in DEFAULT_MODELS)) throw new Error(`Unknown API provider "${provider}"`);
  const keyName = provider as keyof Settings['keys'];
  if (!deps.languageModel && provider !== 'ollama' && !settings.keys[keyName]) {
    throw new ProviderError(`${LABELS[provider]} API key missing — add it in Settings or ${ENV_VARS[provider]}`, {
      provider,
      transient: false,
    });
  }
  const modelId = ref.model ?? DEFAULT_MODELS[provider]!;
  const model = deps.languageModel ?? buildModel(provider, modelId, settings);
  const secrets = Object.values(settings.keys).filter((v): v is string => typeof v === 'string' && v.length > 0);
  const wrap = (e: unknown) => toProviderError(e, provider, secrets);
  // @ai-sdk/openai defaults strictJsonSchema to true; strict mode rejects our optional properties and
  // the root anyOf of SceneSpecSchema with HTTP 400. Validation happens on our side with Zod anyway.
  const structuredOptions = provider === 'openai' ? {openai: {strictJsonSchema: false}} : undefined;

  return makeProvider(
    {
      name: `${provider}:${modelId}`,
      capabilities: {nativeWebSearch: NATIVE_WEB_SEARCH.has(provider), vision: !['mistral', 'ollama'].includes(provider)},
      async object({jsonSchema: js, schemaName, system, prompt, signal}) {
        try {
          // generateObject is deprecated in ai 7; generateText + Output.object is the replacement.
          const r = await generateText({
            model,
            output: Output.object({schema: jsonSchema(js as Parameters<typeof jsonSchema>[0]), name: schemaName}),
            system,
            prompt,
            abortSignal: signal,
            maxRetries: 0,
            ...(structuredOptions ? {providerOptions: structuredOptions} : {}),
          });
          return r.output;
        } catch (e) {
          const unparseable =
            NoObjectGeneratedError.isInstance(e) || JSONParseError.isInstance(e) || TypeValidationError.isInstance(e);
          // A 400 on the structured call usually means the provider refused the schema itself
          // (strict mode, unsupported keywords): retry once as plain text with the schema in the prompt.
          const schemaRejected = APICallError.isInstance(e) && e.statusCode === 400;
          if (!unparseable && !schemaRejected) throw wrap(e);
        }
        // Fallback: ask for plain text; makeProvider extracts and validates the JSON.
        try {
          const r = await generateText({
            model,
            system,
            prompt: `${prompt}\n\nReturn only a JSON object matching this JSON schema:\n${JSON.stringify(js)}`,
            abortSignal: signal,
            maxRetries: 0,
          });
          return r.text;
        } catch (e) {
          throw wrap(e);
        }
      },
      async text({system, prompt, signal}) {
        try {
          const r = await generateText({model, system, prompt, abortSignal: signal, maxRetries: 0});
          return r.text;
        } catch (e) {
          throw wrap(e);
        }
      },
    },
    {secrets, sleep: deps.sleep},
  );
}
