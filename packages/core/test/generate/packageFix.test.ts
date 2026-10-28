import {zodSchema} from 'ai';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {StepContext} from '../../src/generate/context.js';
import {proposeThumbnails, writeYoutube} from '../../src/generate/prompts.js';
import {applyThumbnailChoice, JPEG_WARNING, packageStep, ThumbnailsOutputSchema} from '../../src/generate/steps/package.js';
import {chapters, describe as describeVideo, describeFitted, YoutubeOutputSchema} from '../../src/generate/youtube.js';
import {demoResponder} from '../../src/llm/demoResponder.js';
import {ProjectSchema, type Project} from '../../src/project/schema.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'package-fix-'));
});
afterEach(() => fs.rm(dir, {recursive: true, force: true}));

const calls = vi.fn();
const llm = {
  name: 'fake',
  capabilities: {nativeWebSearch: false, vision: false},
  generateObject: async ({schema, system, prompt}: {schema: never; system: string; prompt: string}) => {
    calls();
    return demoResponder({schema, system, prompt});
  },
  generateText: async () => '',
};
const ctx = (): StepContext => ({projectDir: dir, llm, settings: {keys: {}}, onProgress: () => {}}) as unknown as StepContext;
const scene = (i: number, seconds: number, title = `Titre ${i}`) => ({
  id: `s${i}`,
  narration: `Scène ${i}.`,
  spec: {type: 'title', title, decor: 'none', characters: 0},
  status: 'ok',
  durationFrames: Math.round(seconds * 30),
  factIds: [] as string[],
  warnings: [],
});
const project = (seconds: number[] = [12, 12, 12, 12], extra: Record<string, unknown> = {}): Project =>
  ({
    version: 1,
    brief: {topic: 'Les retraites', language: 'fr', style: 'papier'},
    sources: [],
    facts: [],
    scenes: seconds.map((s, i) => scene(i + 1, s)),
    voice: {engine: 'none'},
    progress: {done: []},
    ...extra,
  }) as unknown as Project;
const render = (pngBytes = 10_000) =>
  vi.fn(async (_d: string, _p: Project, _s: unknown, out: string) => {
    await fs.mkdir(path.dirname(out), {recursive: true});
    await fs.writeFile(out, Buffer.alloc(out.endsWith('.jpg') ? 5_000 : pngBytes, 1));
    return out;
  });
const exists = (f: string) => fs.stat(path.join(dir, f)).then(() => true, () => false);

describe('re-running package keeps the user work', () => {
  it('keeps chosen, options and copy, with no LLM call and no re-render', async () => {
    const r = render();
    const first = await packageStep({renderThumbnail: r})(project(), ctx());
    const chosenRun = await applyThumbnailChoice(dir, {...first, thumbnail: first.thumbnail}, 2, {renderThumbnail: r});
    expect(chosenRun.thumbnail!.chosen).toBe(2);
    calls.mockClear();
    r.mockClear();
    const edited = project([12, 12, 12, 12, 12]);
    const second = await packageStep({renderThumbnail: r})({...edited, thumbnail: chosenRun.thumbnail, youtube: first.youtube}, ctx());
    expect(calls).not.toHaveBeenCalled();
    expect(r).not.toHaveBeenCalled();
    expect(second.thumbnail!.chosen).toBe(2);
    expect(second.thumbnail!.options).toEqual(first.thumbnail!.options);
    expect(second.youtube!.titles).toEqual(first.youtube!.titles);
    expect(second.youtube!.hashtags).toEqual(first.youtube!.hashtags);
    expect(second.youtube!.chapters).toHaveLength(5);
  });

  it('re-renders only the missing option files', async () => {
    const r = render();
    const first = await packageStep({renderThumbnail: r})(project(), ctx());
    await fs.rm(path.join(dir, 'out/thumbnail-2.png'));
    r.mockClear();
    await packageStep({renderThumbnail: r})(first, ctx());
    expect(r).toHaveBeenCalledTimes(1);
    expect(r.mock.calls[0]![3]).toBe(path.join(dir, 'out', 'thumbnail-2.png'));
  });
});

describe('applyThumbnailChoice', () => {
  it('switches PNG to JPEG and back, leaving one thumbnail file and the right warning', async () => {
    // option 1 is small; option 2 is over 2 MB as PNG
    const r = vi.fn(async (_d: string, _p: Project, _spec: unknown, out: string) => {
      await fs.mkdir(path.dirname(out), {recursive: true});
      const big = out.endsWith('thumbnail-2.png');
      await fs.writeFile(out, Buffer.alloc(big ? 3_000_000 : 2_000, 1));
      return out;
    });
    const first = await packageStep({renderThumbnail: r as never})(project(), ctx());
    expect(first.thumbnail!.file).toBe('out/thumbnail.png');
    const toJpeg = await applyThumbnailChoice(dir, first, 1, {renderThumbnail: r as never});
    expect(toJpeg.thumbnail).toMatchObject({chosen: 1, file: 'out/thumbnail.jpg'});
    expect(toJpeg.youtube!.warnings).toContain(JPEG_WARNING);
    expect(await exists('out/thumbnail.jpg')).toBe(true);
    expect(await exists('out/thumbnail.png')).toBe(false);
    const back = await applyThumbnailChoice(dir, toJpeg, 0, {renderThumbnail: r as never});
    expect(back.thumbnail).toMatchObject({chosen: 0, file: 'out/thumbnail.png'});
    expect(back.youtube!.warnings).not.toContain(JPEG_WARNING);
    expect(await exists('out/thumbnail.jpg')).toBe(false);
    expect(await exists('out/thumbnail.png')).toBe(true);
    // a package re-run keeps a JPEG choice and its warning
    const rerun = await packageStep({renderThumbnail: r as never})(toJpeg, ctx());
    expect(rerun.thumbnail).toMatchObject({chosen: 1, file: 'out/thumbnail.jpg'});
    expect(rerun.youtube!.warnings).toContain(JPEG_WARNING);
  });
  it('rejects an index outside the options', async () => {
    const first = await packageStep({renderThumbnail: render()})(project(), ctx());
    await expect(applyThumbnailChoice(dir, first, 3)).rejects.toThrow(/does not exist/);
  });
});

describe('thumbnail schema', () => {
  it('rejects chosen outside the options', () => {
    const spec = {words: ['A', 'B'], characters: 1, element: 'none', highlight: 0};
    const t = ProjectSchema.shape.thumbnail;
    expect(t.safeParse({options: [spec], chosen: 1, file: 'f'}).success).toBe(false);
    expect(t.safeParse({options: [spec], chosen: 0, file: 'f'}).success).toBe(true);
  });
});

describe('safe description', () => {
  const out = {titles: ['A', 'B', 'C'], hook: 'Un <b>hook</b>. Deux.', hashtags: ['#aa', '#bb', '#cc']};
  const withSources = (n: number, kind: 'url' | 'file' = 'url', title = (i: number) => `Source ${i}`, uri = (i: number) => `https://x.example/${i}`) => {
    const p = project([12, 12, 12], {
      sources: Array.from({length: n}, (_, i) => ({id: `a${i}`, kind, title: title(i), uri: uri(i), textPath: 'x'})),
      facts: Array.from({length: n}, (_, i) => ({id: `f${i}`, statement: 's', verified: true, sourceId: `a${i}`})),
    });
    p.scenes[0]!.factIds = Array.from({length: n}, (_, i) => `f${i}`);
    return p;
  };

  it('never prints the path or URI of a file source', () => {
    const p = withSources(2, 'file', (i) => (i === 0 ? 'D:\\Users\\sami\\Documents\\memo-interne.pdf' : 'Rapport 2024'), () => 'D:\\Users\\sami\\Documents\\x.pdf');
    const text = describeVideo(p, out, []);
    expect(text).toContain('- memo-interne.pdf\n- Rapport 2024\n');
    expect(text).not.toMatch(/Users|sami|Documents|x\.pdf/);
  });

  it('strips angle brackets and collapses newlines in titles', () => {
    const p = withSources(1, 'url', () => 'Page <script>\nsuite');
    p.scenes[0]!.spec = {type: 'title', title: 'Deux\nlignes <b>', decor: 'none', characters: 0} as never;
    const text = describeVideo(p, out, chapters(project([12, 12, 12])).map((c, i) => ({...c, label: i === 0 ? 'Deux\nlignes <b>' : c.label})));
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain('0:00 Deux lignes b\n');
    expect(text).toContain('- Page script suite \u2014 https://x.example/0');
  });

  it('collapses a newline in a scene title when building chapters', () => {
    const p = project([12, 12, 12]);
    p.scenes[0]!.spec = {type: 'title', title: 'Deux\nlignes', decor: 'none', characters: 0} as never;
    expect(chapters(p)[0]!.label).toBe('Deux lignes');
  });

  it('trims the sources first when the description exceeds 5000 bytes, with a warning', () => {
    const p = withSources(40, 'url', (i) => `Une source assez longue numéro ${i} ${'é'.repeat(30)}`, (i) => `https://x.example/${'p'.repeat(60)}/${i}`);
    const fitted = describeFitted(p, out, chapters(p));
    expect(Buffer.byteLength(fitted.text, 'utf8')).toBeLessThanOrEqual(5000);
    expect(fitted.warnings.length).toBeGreaterThan(0);
    expect(fitted.text).toContain('Sources:');
    expect(fitted.text.endsWith('#aa #bb #cc')).toBe(true);
    expect(describeFitted(withSources(2), out, []).warnings).toEqual([]);
  });
});

describe('chapters and titles', () => {
  it('a short first scene absorbs the next one', () => {
    expect(chapters(project([5, 30, 30, 30])).map((c) => c.t)).toEqual(['0:00', '0:35', '1:05']);
  });
  it('counts title length on NFC text', () => {
    const decomposed = 'e\u0301'.repeat(70);
    expect(decomposed.length).toBe(140);
    expect(YoutubeOutputSchema.safeParse({titles: [decomposed, 'B', 'C'], hook: 'h', hashtags: ['#aa', '#bb', '#cc']}).success).toBe(true);
  });
  it('emits no Unicode pattern in the JSON schema and describes the limits', async () => {
    const json = JSON.stringify(zodSchema(YoutubeOutputSchema).jsonSchema);
    expect(json).not.toContain('\\p{');
    expect(json).toContain('At most 70 characters');
    expect(YoutubeOutputSchema.safeParse({titles: ['A', 'B', 'C'], hook: 'h', hashtags: ['#économie', '#a_b', '#12']}).success).toBe(true);
    expect(YoutubeOutputSchema.safeParse({titles: ['A', 'B', 'C'], hook: 'h', hashtags: ['#a', '#b b', '#cc']}).success).toBe(false);
  });
});

describe('demoResponder with the real prompts', () => {
  const scenes = [{title: 'Titre 1', narration: 'Une narration.'}, {title: 'Titre 2', narration: 'Une autre.'}];
  it('answers proposeThumbnails and writeYoutube', () => {
    const t = proposeThumbnails('La dette publique française', 'fr', 'papier', scenes, []);
    expect(ThumbnailsOutputSchema.safeParse(demoResponder({schema: ThumbnailsOutputSchema, ...t})).success).toBe(true);
    const y = writeYoutube('La dette publique française', 'fr', scenes);
    expect(YoutubeOutputSchema.safeParse(demoResponder({schema: YoutubeOutputSchema, ...y})).success).toBe(true);
  });
});
