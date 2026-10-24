import {z} from 'zod';
import {redact} from '../../llm/redact.js';
import type {Project} from '../../project/schema.js';
import {ingestSource, type Source} from '../../research/ingest.js';
import {braveSearch, tavilySearch, type SearchHit} from '../../research/search.js';
import type {Step, StepContext} from '../context.js';
import {searchQueries} from '../prompts.js';

const MAX_SEARCH_SOURCES = 6;
const QueriesSchema = z.object({queries: z.array(z.string().min(1).max(120)).min(1).max(3)});

const isUrl = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);

/** Lowercase host (done by URL), drop #fragment and a trailing slash. */
export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return u.replace(/#.*$/, '').replace(/\/$/, '');
  }
}

function searchFn(web: Project['brief']['webSearch'], ctx: StepContext): ((q: string) => Promise<SearchHit[]>) | undefined {
  const {tavily, brave} = ctx.settings.keys;
  if (web === 'native') return ctx.nativeSearch;
  if (web === 'tavily' && tavily) return (q) => tavilySearch(q, tavily, ctx.fetch);
  if (web === 'brave' && brave) return (q) => braveSearch(q, brave, ctx.fetch);
  return undefined;
}

export const sourcesStep: Step = async (p, ctx) => {
  const log = (m: string) => ctx.onProgress({step: 'sources', log: m});
  const secrets = Object.values(ctx.settings.keys).filter((v): v is string => typeof v === 'string' && v.length > 0);
  const msg = (e: unknown) => redact(e instanceof Error ? e.message : String(e), secrets);
  const sources: Source[] = [];
  const seen = new Set<string>();
  const nextId = () => `s${sources.length + 1}`;

  for (const uri of p.brief.sources) {
    const kind = isUrl(uri) ? 'url' : 'file';
    if (kind === 'url') seen.add(normalizeUrl(uri));
    sources.push(await ingestSource(ctx.projectDir, {id: nextId(), uri, kind}, {fetch: ctx.fetch}));
  }

  const web = p.brief.webSearch;
  if (web !== 'off') {
    const search = searchFn(web, ctx);
    if (!search) {
      log(`Web search "${web}" is not available (missing key or provider support); skipping`);
    } else {
      const hits: SearchHit[] = [];
      try {
        const {queries} = await ctx.llm.generateObject({
          schema: QueriesSchema,
          ...searchQueries(p.brief.topic, p.brief.language),
          signal: ctx.signal,
        });
        for (const q of queries) {
          try {
            hits.push(...(await search(q)));
          } catch (e) {
            if (ctx.signal?.aborted) throw e;
            log(`Search failed for "${q}": ${msg(e)}`);
          }
        }
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
        log(`Web search skipped: ${msg(e)}`);
      }
      let kept = 0;
      for (const hit of hits) {
        if (kept >= MAX_SEARCH_SOURCES) break;
        const norm = normalizeUrl(hit.url);
        if (seen.has(norm)) continue;
        seen.add(norm);
        kept++;
        const id = nextId();
        const s: Source = hit.content
          ? await ingestSource(ctx.projectDir, {id, uri: hit.url, kind: 'search', title: hit.title, text: hit.content}, {fetch: ctx.fetch})
          : {...(await ingestSource(ctx.projectDir, {id, uri: hit.url, kind: 'url', title: hit.title}, {fetch: ctx.fetch})), kind: 'search'};
        sources.push(s);
      }
    }
  }

  const failed = sources.filter((s) => s.error).length;
  log(`${sources.length} sources (${failed} failed)`);
  return {...p, sources};
};
