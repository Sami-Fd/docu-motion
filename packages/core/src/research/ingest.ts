import {mkdirSync, realpathSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Readability} from '@mozilla/readability';
import {parseHTML} from 'linkedom';
import {extractText, getDocumentProxy} from 'unpdf';
import type {Project} from '../project/schema.js';

export type Source = Project['sources'][number];

export type IngestInput = {
  id: string;
  uri: string;
  kind: 'url' | 'file' | 'search';
  title?: string;
  text?: string;
};

export type IngestDeps = {fetch: typeof fetch; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5_000_000;

class IngestError extends Error {}

/** Collapse whitespace; paragraphs (blank-line separated) stay separated by a blank line. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t\f\v]*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function htmlToText(html: string): {title?: string; text: string} {
  const {document} = parseHTML(html);
  const title = document.title?.trim() || undefined;
  let article: {content?: string | null; textContent?: string | null} | null = null;
  try {
    article = new Readability(document as unknown as Document, {charThreshold: 100}).parse();
  } catch {
    article = null;
  }
  if (article?.content) {
    const {document: doc} = parseHTML(`<body>${article.content}</body>`);
    const blocks = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre'))
      .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (blocks.length) return {title, text: blocks.join('\n\n')};
  }
  if (article?.textContent?.trim()) return {title, text: article.textContent};
  return {title, text: document.body?.textContent ?? ''};
}

function decodeBody(bytes: Uint8Array, contentType: string, isHtml: boolean): string {
  let label = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  if (!label && isHtml) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
    label =
      /<meta[^>]+charset\s*=\s*["']?([^\s;"'>\/]+)/i.exec(head)?.[1] ??
      /<meta[^>]+http-equiv\s*=\s*["']?content-type[^>]*charset\s*=\s*([^\s;"'>]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const {text} = await extractText(pdf, {mergePages: true});
  return text;
}

/** Reads a response body, aborting once more than maxBytes have arrived. */
async function readCapped(res: Response, maxBytes: number, aborted: Promise<never>): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel().catch(() => {});
    throw new IngestError('too large');
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new IngestError('too large');
      chunks.push(value);
    }
  } catch (e) {
    void reader.cancel().catch(() => {});
    throw e;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function fromUrl(input: IngestInput, deps: IngestDeps): Promise<{title?: string; text: string}> {
  let scheme: string;
  try {
    scheme = new URL(input.uri).protocol;
  } catch {
    throw new IngestError('unsupported URL scheme');
  }
  if (scheme !== 'http:' && scheme !== 'https:') throw new IngestError('unsupported URL scheme');
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Rejects on timeout even if the injected fetch or the body stream ignores the signal.
  const aborted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new IngestError(`timeout after ${timeoutMs} ms`);
      controller.abort(err);
      reject(err);
    }, timeoutMs);
    deps.signal?.addEventListener('abort', () => reject(deps.signal!.reason ?? new DOMException('Aborted', 'AbortError')), {once: true});
  });
  aborted.catch(() => {});
  const fetchSignal = deps.signal ? AbortSignal.any([controller.signal, deps.signal]) : controller.signal;
  try {
    if (deps.signal?.aborted) throw deps.signal.reason ?? new DOMException('Aborted', 'AbortError');
    const res = await Promise.race([deps.fetch(input.uri, {signal: fetchSignal}), aborted]);
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new IngestError(`HTTP ${res.status}`);
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const known = type === 'text/html' || type === 'application/pdf' || type === 'text/plain' || type === 'text/markdown';
    if (!known) {
      void res.body?.cancel().catch(() => {});
      throw new IngestError(`unsupported content type ${type || 'unknown'}`);
    }
    const bytes = await readCapped(res, maxBytes, aborted);
    if (type === 'application/pdf') return {text: await Promise.race([pdfToText(bytes), aborted])};
    const body = decodeBody(bytes, res.headers.get('content-type') ?? '', type === 'text/html');
    return type === 'text/html' ? htmlToText(body) : {text: body};
  } finally {
    clearTimeout(timer);
  }
}

async function fromFile(projectDir: string, input: IngestInput): Promise<{title?: string; text: string}> {
  const root = path.resolve(projectDir);
  const abs = path.resolve(root, input.uri);
  const inside = (p: string, r: string) => {
    const rel = path.relative(r, p);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  if (!inside(abs, root)) throw new IngestError('file outside project');
  const ext = path.extname(abs).toLowerCase();
  if (!['.pdf', '.txt', '.md'].includes(ext)) throw new IngestError('unsupported file type');
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    throw new IngestError('file not found');
  }
  if (!inside(real, realpathSync(root))) throw new IngestError('file outside project');
  const buf = await readFile(real);
  const title = path.basename(abs);
  if (ext === '.pdf') return {title, text: await pdfToText(new Uint8Array(buf))};
  return {title, text: buf.toString('utf8')};
}

/** Fetches/reads one source, writes sources/<id>.txt and returns the project source entry. */
export async function ingestSource(projectDir: string, input: IngestInput, deps: IngestDeps): Promise<Source> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.id)) throw new Error(`Invalid source id "${input.id}"`);
  const textPath = `sources/${input.id}.txt`;
  const entry: Source = {id: input.id, kind: input.kind, title: input.title ?? input.uri, uri: input.uri, textPath};
  let text = '';
  try {
    let r: {title?: string; text: string};
    if (input.text !== undefined) r = {text: input.text};
    else if (input.kind === 'url') r = await fromUrl(input, deps);
    else if (input.kind === 'file') r = await fromFile(projectDir, input);
    else throw new IngestError('no content');
    text = normalizeText(r.text);
    if (r.title && !input.title) entry.title = r.title;
  } catch (e) {
    if (deps.signal?.aborted) throw e;
    entry.error = e instanceof IngestError ? e.message : e instanceof Error ? e.message || e.name : String(e);
    text = '';
  }
  mkdirSync(path.join(projectDir, 'sources'), {recursive: true});
  writeFileSync(path.join(projectDir, textPath), text, 'utf8');
  return entry;
}
