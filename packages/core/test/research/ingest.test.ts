import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {ingestSource} from '../../src/research/ingest.js';

const fx = (n: string) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures', n));
const tmp = () => mkdtempSync(path.join(tmpdir(), 'dm été ingest '));
const resp = (body: BodyInit | null, type: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, {status, headers: {'content-type': type, ...headers}});
const fetchOf = (r: () => Response | Promise<Response>) => (async () => r()) as unknown as typeof fetch;
const text = (dir: string, id: string) => readFileSync(path.join(dir, 'sources', `${id}.txt`), 'utf8');

describe('ingestSource', () => {
  it('extracts article text from html with title, dropping nav and footer', async () => {
    const dir = tmp();
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {
      fetch: fetchOf(() => resp(fx('article.html'), 'text/html; charset=utf-8')),
    });
    expect(s).toEqual({id: 's1', kind: 'url', title: 'The Quiet Lighthouse', uri: 'https://x.test/a', textPath: 'sources/s1.txt'});
    const t = text(dir, 's1');
    expect(t).toContain('guided ships safely to shore');
    expect(t).not.toContain('NAVIGATION-MENU-ITEM');
    expect(t).not.toContain('FOOTER-COPYRIGHT-NOISE');
  });

  it('extracts pdf text', async () => {
    const dir = tmp();
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a.pdf', kind: 'url'}, {
      fetch: fetchOf(() => resp(fx('sample.pdf'), 'application/pdf')),
    });
    expect(s.error).toBeUndefined();
    expect(text(dir, 's1')).toContain('The lighthouse at Cap Frehel was built in 1950.');
  });

  it('records HTTP errors with an empty text file', async () => {
    const dir = tmp();
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {
      fetch: fetchOf(() => resp('nope', 'text/html', 404)),
    });
    expect(s.error).toBe('HTTP 404');
    expect(s.textPath).toBe('sources/s1.txt');
    expect(text(dir, 's1')).toBe('');
  });

  it('times out on a hanging fetch', async () => {
    const dir = tmp();
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const t0 = Date.now();
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {fetch: hang, timeoutMs: 50});
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(s.error).toMatch(/timeout|abort/i);
  });

  it('times out when the fetch ignores the signal', async () => {
    const dir = tmp();
    const never = (() => new Promise(() => {})) as unknown as typeof fetch;
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {fetch: never, timeoutMs: 50});
    expect(s.error).toMatch(/timeout|abort/i);
  });

  it('times out when the body stalls', async () => {
    const dir = tmp();
    const body = new ReadableStream<Uint8Array>({pull: () => new Promise(() => {})});
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {
      fetch: fetchOf(() => resp(body, 'text/plain')),
      timeoutMs: 50,
    });
    expect(s.error).toMatch(/timeout|abort/i);
  });

  it('rejects a 6 MB body (streamed) as too large', async () => {
    const dir = tmp();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1_000_000).fill(97));
        if (pulled >= 50) c.close();
      },
    });
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {
      fetch: fetchOf(() => resp(body, 'text/plain')),
    });
    expect(s.error).toBe('too large');
    expect(pulled).toBeLessThan(10);
    expect(text(dir, 's1')).toBe('');
  });

  it('rejects early on a large content-length', async () => {
    const dir = tmp();
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {
      fetch: fetchOf(() => resp('small', 'text/plain', 200, {'content-length': '50000000'})),
    });
    expect(s.error).toBe('too large');
  });

  it('rejects unsupported content types', async () => {
    const dir = tmp();
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a.png', kind: 'url'}, {
      fetch: fetchOf(() => resp(new Uint8Array([1, 2, 3]), 'image/png')),
    });
    expect(s.error).toBe('unsupported content type image/png');
  });

  it('passes through text/plain with normalised whitespace', async () => {
    const dir = tmp();
    await ingestSource(dir, {id: 's1', uri: 'https://x.test/a.txt', kind: 'url'}, {
      fetch: fetchOf(() => resp('a   b\n\n\n\nc\nd  e', 'text/plain')),
    });
    expect(text(dir, 's1')).toBe('a b\n\nc d e');
  });

  it('removes its abort listener from the caller signal when done', async () => {
    const dir = tmp();
    const ac = new AbortController();
    let added = 0;
    let removed = 0;
    const add = ac.signal.addEventListener.bind(ac.signal);
    const remove = ac.signal.removeEventListener.bind(ac.signal);
    ac.signal.addEventListener = ((...a: Parameters<typeof add>) => (a[0] === 'abort' && added++, add(...a))) as typeof add;
    ac.signal.removeEventListener = ((...a: Parameters<typeof remove>) => (a[0] === 'abort' && removed++, remove(...a))) as typeof remove;
    await ingestSource(dir, {id: 's1', uri: 'https://x.test/a.txt', kind: 'url'}, {
      fetch: fetchOf(() => resp('hello', 'text/plain')),
      signal: ac.signal,
    });
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
  });

  it('reads a local txt file in a dir with spaces and accents', async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'notes é.txt'), 'Hello   monde');
    const s = await ingestSource(dir, {id: 's1', uri: 'notes é.txt', kind: 'file'}, {fetch: fetchOf(() => resp('', 'text/plain'))});
    expect(s.error).toBeUndefined();
    expect(s.title).toBe('notes é.txt');
    expect(text(dir, 's1')).toBe('Hello monde');
  });

  it('reads a local pdf file', async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, 'in'));
    writeFileSync(path.join(dir, 'in', 'a.pdf'), fx('sample.pdf'));
    const s = await ingestSource(dir, {id: 's1', uri: 'in/a.pdf', kind: 'file'}, {fetch: fetchOf(() => resp('', 'text/plain'))});
    expect(s.error).toBeUndefined();
    expect(text(dir, 's1')).toContain('built in 1950');
  });

  it('rejects unsupported file types, missing files and files outside the project', async () => {
    const dir = tmp();
    const outside = tmp();
    writeFileSync(path.join(outside, 'x.txt'), 'secret');
    writeFileSync(path.join(dir, 'a.docx'), 'x');
    const deps = {fetch: fetchOf(() => resp('', 'text/plain'))};
    expect((await ingestSource(dir, {id: 's1', uri: 'a.docx', kind: 'file'}, deps)).error).toBe('unsupported file type');
    expect((await ingestSource(dir, {id: 's2', uri: 'missing.txt', kind: 'file'}, deps)).error).toMatch(/\S/);
    const rel = path.relative(dir, path.join(outside, 'x.txt'));
    expect((await ingestSource(dir, {id: 's3', uri: rel, kind: 'file'}, deps)).error).toBe('file outside project');
    expect((await ingestSource(dir, {id: 's4', uri: path.join(outside, 'x.txt'), kind: 'file'}, deps)).error).toBe('file outside project');
    expect(text(dir, 's3')).toBe('');
  });

  it('writes provided text (normalised) for search results', async () => {
    const dir = tmp();
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test', kind: 'search', title: 'T', text: 'foo   bar'}, {
      fetch: fetchOf(() => {
        throw new Error('no network');
      }),
    });
    expect(s).toEqual({id: 's1', kind: 'search', title: 'T', uri: 'https://x.test', textPath: 'sources/s1.txt'});
    expect(text(dir, 's1')).toBe('foo bar');
  });

  it('decodes windows-1252 declared in the header', async () => {
    const dir = tmp();
    await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {
      fetch: fetchOf(() => resp(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), 'text/plain; charset=windows-1252')),
    });
    expect(text(dir, 's1')).toBe('café');
  });

  it('decodes windows-1252 declared by a meta tag', async () => {
    const dir = tmp();
    const head = Buffer.from('<!doctype html><html><head><meta charset="iso-8859-1"><title>T</title></head><body><article><p>');
    const para = Buffer.from('Le café est ouvert depuis le matin et les clients arrivent nombreux chaque jour de la semaine, malgré la pluie.', 'latin1');
    const tail = Buffer.from('</p></article></body></html>');
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {
      fetch: fetchOf(() => resp(Buffer.concat([head, para, tail]), 'text/html')),
    });
    expect(s.error).toBeUndefined();
    expect(text(dir, 's1')).toContain('café');
  });

  it('still yields body text when Readability finds no article', async () => {
    const dir = tmp();
    await ingestSource(dir, {id: 's1', uri: 'https://x.test/a', kind: 'url'}, {
      fetch: fetchOf(() => resp('<html><head><title>Tiny</title></head><body>just a few words</body></html>', 'text/html')),
    });
    expect(text(dir, 's1')).toContain('just a few words');
  });

  it('reports a corrupt pdf as an error without throwing', async () => {
    const dir = tmp();
    const s = await ingestSource(dir, {id: 's1', uri: 'https://x.test/a.pdf', kind: 'url'}, {
      fetch: fetchOf(() => resp('this is not a pdf', 'application/pdf')),
    });
    expect(s.error).toMatch(/\S/);
    expect(text(dir, 's1')).toBe('');
  });

  it('rejects non-http url schemes', async () => {
    const dir = tmp();
    const deps = {fetch: fetchOf(() => resp('x', 'text/plain'))};
    for (const uri of ['file:///etc/passwd', 'ftp://x.test/a', 'not a url']) {
      expect((await ingestSource(dir, {id: 's1', uri, kind: 'url'}, deps)).error).toBe('unsupported URL scheme');
    }
  });

  it('refuses unsafe ids', async () => {
    await expect(
      ingestSource(tmp(), {id: '../evil', uri: 'x', kind: 'search', text: 'x'}, {fetch: fetchOf(() => resp('', 'text/plain'))}),
    ).rejects.toThrow(/id/i);
  });
});
