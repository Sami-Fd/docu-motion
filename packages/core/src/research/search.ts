import {createAnthropic} from '@ai-sdk/anthropic';
import {createGoogle} from '@ai-sdk/google';
import {createOpenAI} from '@ai-sdk/openai';
import {generateText, type LanguageModel, type ToolSet} from 'ai';
import {buildModel, DEFAULT_MODELS, toProviderError} from '../llm/aiSdk.js';
import {redact} from '../llm/redact.js';
import type {ProviderRef} from '../project/schema.js';
import type {Settings} from '../settings/settings.js';

export type SearchHit = {title: string; url: string; content?: string};

const MAX_RESULTS = 5;

async function httpFailure(res: Response, label: string, key: string): Promise<Error> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 200);
  } catch {
    // ignore unreadable body
  }
  return new Error(redact(`${label} search failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`, [key]));
}

function rethrow(e: unknown, label: string, key: string): never {
  if (e instanceof Error && e.name === 'AbortError') throw e;
  const msg = e instanceof Error ? e.message : String(e);
  throw new Error(redact(msg.startsWith(`${label} search failed`) ? msg : `${label} search failed: ${msg}`, [key]));
}

export async function tavilySearch(query: string, key: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<SearchHit[]> {
  try {
    const res = await fetchFn('https://api.tavily.com/search', {
      method: 'POST',
      signal,
      headers: {'content-type': 'application/json', authorization: `Bearer ${key}`},
      body: JSON.stringify({query, max_results: MAX_RESULTS, include_raw_content: true}),
    });
    if (!res.ok) throw await httpFailure(res, 'Tavily', key);
    const data = (await res.json()) as {
      results?: {title?: string; url?: string; content?: string; raw_content?: string | null}[];
    };
    return (data.results ?? [])
      .filter((r) => typeof r.url === 'string' && r.url)
      .map((r) => {
        const content = r.raw_content || r.content || undefined;
        return {title: r.title || r.url!, url: r.url!, ...(content ? {content} : {})};
      });
  } catch (e) {
    return rethrow(e, 'Tavily', key);
  }
}

export async function braveSearch(query: string, key: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<SearchHit[]> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`;
    const res = await fetchFn(url, {signal, headers: {accept: 'application/json', 'X-Subscription-Token': key}});
    if (!res.ok) throw await httpFailure(res, 'Brave', key);
    const data = (await res.json()) as {web?: {results?: {title?: string; url?: string}[]}};
    return (data.web?.results ?? [])
      .filter((r) => typeof r.url === 'string' && r.url)
      .map((r) => ({title: r.title || r.url!, url: r.url!}));
  } catch (e) {
    return rethrow(e, 'Brave', key);
  }
}

/** Maps AI SDK `sources` to search hits (URL sources only). */
export function sourcesToHits(sources: readonly unknown[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const s of sources as {sourceType?: string; url?: string; title?: string}[]) {
    if (s?.sourceType === 'url' && typeof s.url === 'string' && s.url) hits.push({title: s.title || s.url, url: s.url});
  }
  return hits;
}

/** Native (provider-side) web search through the AI SDK provider tools. Undefined when unsupported. */
export function nativeSearchFor(
  ref: ProviderRef,
  settings: Settings,
  deps: {languageModel?: LanguageModel} = {},
): ((q: string, signal?: AbortSignal) => Promise<SearchHit[]>) | undefined {
  if (ref.kind !== 'api') return undefined;
  let tools: Record<string, unknown>;
  switch (ref.provider) {
    case 'anthropic':
      tools = {web_search: createAnthropic({}).tools.webSearch_20250305()};
      break;
    case 'openai':
      tools = {web_search: createOpenAI({}).tools.webSearch()};
      break;
    case 'google':
      tools = {google_search: createGoogle({}).tools.googleSearch({})};
      break;
    default:
      return undefined;
  }
  const secrets = Object.values(settings.keys).filter((v): v is string => typeof v === 'string' && v.length > 0);
  return async (query, signal) => {
    try {
      const model = deps.languageModel ?? buildModel(ref.provider, ref.model ?? DEFAULT_MODELS[ref.provider]!, settings);
      const r = await generateText({
        model,
        tools: tools as ToolSet,
        prompt: `Search the web for: ${query}\nList the most relevant, reliable pages.`,
        abortSignal: signal,
        maxRetries: 0,
      });
      return sourcesToHits(r.sources).slice(0, MAX_RESULTS);
    } catch (e) {
      throw toProviderError(e, ref.provider, secrets);
    }
  };
}

export type WebSearchMode = 'off' | 'native' | 'tavily' | 'brave';

/**
 * The web search mode a new project uses, and why it differs from the setting (user sources given,
 * or an explicit choice that cannot be used and falls back to the auto chain).
 */
export function explainWebSearch(
  settings: Settings,
  ref: ProviderRef,
  hasUserSources: boolean,
): {mode: WebSearchMode; reason?: string} {
  if (hasUserSources) return {mode: 'off', reason: 'sources given'};
  const native = ref.kind === 'api' && ['anthropic', 'openai', 'google'].includes(ref.provider);
  const s = settings.search;
  if (s === 'off') return {mode: 'off'};
  if (s === 'native' && native) return {mode: 'native'};
  if (s === 'tavily' && settings.keys.tavily) return {mode: 'tavily'};
  if (s === 'brave' && settings.keys.brave) return {mode: 'brave'};
  // auto, or an explicit choice that cannot be used: fall back to the auto chain
  const mode: WebSearchMode = native ? 'native' : settings.keys.tavily ? 'tavily' : settings.keys.brave ? 'brave' : 'off';
  if (s === 'auto') return {mode};
  const why =
    s === 'native'
      ? `search "native" needs the anthropic, openai or google API provider, not ${ref.kind}:${ref.provider}`
      : `search "${s}" has no key (Settings or ${s === 'tavily' ? 'TAVILY_API_KEY' : 'BRAVE_API_KEY'})`;
  return {mode, reason: `${why}; falling back to ${mode}`};
}

export function resolveWebSearch(settings: Settings, ref: ProviderRef, hasUserSources: boolean): WebSearchMode {
  return explainWebSearch(settings, ref, hasUserSources).mode;
}
