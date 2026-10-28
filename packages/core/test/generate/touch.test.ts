import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {THUMBNAIL_EXAMPLES} from '@docu-motion/scenes';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Step, StepContext} from '../../src/generate/context.js';
import {chooseThumbnail, editNarration, refreshYoutube, regenerateScene, rerender} from '../../src/generate/touch.js';
import {createFakeProvider} from '../../src/llm/fake.js';
import {STEP_NAMES, type Project} from '../../src/project/schema.js';
import {loadProject, saveProject} from '../../src/project/store.js';
import {SettingsSchema} from '../../src/settings/settings.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'touch-'));
});
afterEach(() => fs.rm(dir, {recursive: true, force: true}));

const title = {type: 'title', title: 'Nouveau', decor: 'none', characters: 0};
const scene = (id: string, warnings: string[] = []) => ({
  id, narration: `Narration ${id}.`, spec: {type: 'title', title: id, decor: 'none', characters: 0}, status: 'ok',
  durationFrames: 100, factIds: [], warnings,
});
const spec = (t: string) => ({type: 'title', title: t, decor: 'none', characters: 0});
const project = (extra: Partial<Project> = {}): Project =>
  ({
    version: 1,
    brief: {topic: 'T', language: 'fr', targetMinutes: 3, style: 'papier', provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off', sources: []},
    sources: [], facts: [],
    scenes: ['s01', 's02', 's03'].map((id) => scene(id, id === 's03' ? ['Layout may overflow the frame', 'Other'] : [])),
    voice: {engine: 'none'},
    progress: {done: [...STEP_NAMES]},
    ...extra,
  }) as unknown as Project;

function ctx(onPrompt: (p: string) => void = () => {}): StepContext {
  return {
    projectDir: dir, llm: createFakeProvider(({prompt}) => (onPrompt(prompt), title)), settings: SettingsSchema.parse({}),
    fetch: (async () => new Response('')) as unknown as typeof fetch, onProgress: () => {},
  };
}
const save = (p: Project) => saveProject(dir, p);

describe('editNarration', () => {
  it('sets dirty and clears voice, render, package', async () => {
    await save(project());
    const p = await editNarration(dir, 's02', '  Nouveau texte.  ');
    expect(p.scenes[1]).toMatchObject({narration: 'Nouveau texte.', dirty: true});
    expect(p.progress.done).toEqual(['sources', 'facts', 'script', 'scenes', 'layout']);
    expect((await loadProject(dir)).scenes[1]!.dirty).toBe(true);
  });
  it('validates length', async () => {
    await save(project());
    await expect(editNarration(dir, 's02', '   ')).rejects.toThrow(/1 and 2000/);
    await expect(editNarration(dir, 's02', 'x'.repeat(2001))).rejects.toThrow(/1 and 2000/);
  });
});

describe('unknown scene', () => {
  it('lists the real range', async () => {
    await save(project());
    await expect(editNarration(dir, 's99', 'x')).rejects.toThrow('Unknown scene "s99" — scenes are s01…s03');
    await expect(regenerateScene(dir, 's99', ctx())).rejects.toThrow('Unknown scene "s99" — scenes are s01…s03');
  });
});

describe('regenerateScene', () => {
  it('asks the LLM once, clears the stale layout warning, drops render and package', async () => {
    await save(project());
    const prompts: string[] = [];
    const p = await regenerateScene(dir, 's03', ctx((x) => prompts.push(x)), {checkScene: async () => ({outside: 0})});
    expect(prompts).toHaveLength(1);
    expect((p.scenes[2]!.spec as {title: string}).title).toBe('Nouveau');
    expect(p.scenes[2]!.warnings).toEqual(['Other']);
    expect(p.scenes[0]!.spec).toEqual(spec('s01'));
    expect(p.progress.done).toEqual(['sources', 'facts', 'script', 'scenes', 'voice', 'layout']);
    expect((await loadProject(dir)).scenes[2]!.warnings).toEqual(['Other']);
  });
});

describe('rerender', () => {
  it('runs voice, render, package in order and nothing earlier', async () => {
    await save(project());
    const calls: string[] = [];
    const stub = (n: string): Step => async (p) => (calls.push(n), p);
    const steps = Object.fromEntries(STEP_NAMES.map((n) => [n, stub(n)]));
    const p = await rerender(dir, ctx(), {steps});
    expect(calls).toEqual(['voice', 'render', 'package']);
    expect(p.progress.done).toEqual(['sources', 'facts', 'script', 'scenes', 'layout', 'voice', 'render', 'package']);
  });
});

describe('chooseThumbnail', () => {
  const thumbs = () => project({thumbnail: {options: [0, 1, 2].map((i) => THUMBNAIL_EXAMPLES[i]!), chosen: 0, file: 'out/thumbnail.png'}});
  it('copies option 3 and sets chosen', async () => {
    await fs.mkdir(path.join(dir, 'out'));
    for (const i of [1, 2, 3]) await fs.writeFile(path.join(dir, 'out', `thumbnail-${i}.png`), `img${i}`);
    await save(thumbs());
    const p = await chooseThumbnail(dir, 2);
    expect(p.thumbnail).toMatchObject({chosen: 2, file: 'out/thumbnail.png'});
    expect(await fs.readFile(path.join(dir, 'out', 'thumbnail.png'), 'utf8')).toBe('img3');
    expect((await loadProject(dir)).thumbnail!.chosen).toBe(2);
  });
  it('throws out of range, and without a thumbnail', async () => {
    await save(thumbs());
    await expect(chooseThumbnail(dir, 5)).rejects.toThrow(/choose 0\.\.2/);
    await expect(chooseThumbnail(dir, -1)).rejects.toThrow(/choose 0\.\.2/);
    await save(project());
    await expect(chooseThumbnail(dir, 0)).rejects.toThrow('Run the package step first');
  });
});

describe('refreshYoutube', () => {
  const yt = {titles: ['a'], description: 'd', chapters: [], hashtags: ['#a'], warnings: ['w'], hook: 'h'};
  const th = {options: [0, 1, 2].map((i) => THUMBNAIL_EXAMPLES[i]!), chosen: 1, file: 'out/thumbnail.png'};
  it('clears only the youtube copy on request, and drops package', async () => {
    await save(project({youtube: yt, thumbnail: th}));
    const p = await refreshYoutube(dir, {youtube: true, thumbnails: false});
    expect(p.youtube).toBeUndefined();
    expect(p.thumbnail).toEqual(th);
    expect(p.progress.done).not.toContain('package');
    expect(p.progress.done).toContain('render');
    expect((await loadProject(dir)).youtube).toBeUndefined();
  });
  it('clears only the thumbnail options on request', async () => {
    await save(project({youtube: yt, thumbnail: th}));
    const p = await refreshYoutube(dir, {thumbnails: true, youtube: false});
    expect(p.thumbnail).toBeUndefined();
    expect(p.youtube).toEqual(yt);
  });
  it('clears both by default', async () => {
    await save(project({youtube: yt, thumbnail: th}));
    const p = await refreshYoutube(dir);
    expect(p.youtube).toBeUndefined();
    expect(p.thumbnail).toBeUndefined();
  });
});
