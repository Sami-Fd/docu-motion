import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {THUMBNAIL_EXAMPLES} from '@docu-motion/scenes';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Step, StepContext} from '../../src/generate/context.js';
import {chooseThumbnail, editNarration, refreshYoutube, regenerateScene, rerender} from '../../src/generate/touch.js';
import {audioHash, voiceStep, STALE_RECORDING_WARNING} from '../../src/generate/steps/voice.js';
import {createFakeProvider} from '../../src/llm/fake.js';
import {STEP_NAMES, type Project} from '../../src/project/schema.js';
import {loadProject, saveProject} from '../../src/project/store.js';
import {SettingsSchema} from '../../src/settings/settings.js';
import {LlmOutputError} from '../../src/llm/types.js';
import type {TtsEngine} from '../../src/voice/engines.js';

vi.mock('../../src/render/bundle.js', async (orig) => ({...(await orig<object>()), invalidateBundle: vi.fn()}));

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
  it('counts code points, not UTF-16 units', async () => {
    await save(project());
    await expect(editNarration(dir, 's01', '😀'.repeat(2000))).resolves.toBeDefined();
    await expect(editNarration(dir, 's01', '😀'.repeat(2001))).rejects.toThrow(/1 and 2000/);
  });
  it('validates length', async () => {
    await save(project());
    await expect(editNarration(dir, 's02', '   ')).rejects.toThrow(/1 and 2000/);
    await expect(editNarration(dir, 's02', 'x'.repeat(2001))).rejects.toThrow(/1 and 2000/);
  });
});

describe('unknown scene', () => {
  it('names the single scene without a range', async () => {
    await save(project({scenes: [scene('s01')] as never}));
    await expect(editNarration(dir, 's02', 'x')).rejects.toThrow(/"s02" — scenes are s01$/);
  });

  it('lists the real range', async () => {
    await save(project());
    await expect(editNarration(dir, 's99', 'x')).rejects.toThrow('Unknown scene "s99" — scenes are s01…s03');
    await expect(regenerateScene(dir, 's99', ctx())).rejects.toThrow('Unknown scene "s99" — scenes are s01…s03');
  });
});

describe('regenerateScene', () => {
  it('never downgrades a scene: unusable LLM output throws and leaves project.json unchanged', async () => {
    await save(project());
    const before = await fs.readFile(path.join(dir, 'project.json'));
    const bad = {...ctx(), llm: {...ctx().llm, generateObject: async () => { throw new LlmOutputError('bad', ['x'], '{}'); }}} as unknown as StepContext;
    await expect(regenerateScene(dir, 's03', bad)).rejects.toThrow('Could not regenerate s03: the LLM output was unusable — the scene was left unchanged');
    expect(await fs.readFile(path.join(dir, 'project.json'))).toEqual(before);
  });

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
    await expect(chooseThumbnail(dir, 8)).rejects.toThrow('Thumbnail 9 does not exist (choose 1..3)');
    await expect(chooseThumbnail(dir, -1)).rejects.toThrow('Thumbnail 0 does not exist (choose 1..3)');
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

describe('editNarration then rerender with the real voice step', () => {
  const voiced = async (engine: string) => {
    await fs.mkdir(path.join(dir, 'voice'));
    const scenes = [];
    for (const id of ['s01', 's02', 's03']) {
      const f = path.join(dir, 'voice', id + '.mp3');
      await fs.writeFile(f, 'old');
      await fs.utimes(f, new Date(2020, 0, 1), new Date(2020, 0, 1));
      scenes.push({...scene(id), audio: {path: 'voice/' + id + '.mp3', seconds: 3, hash: audioHash('Narration ' + id + '.', engine, 'v1')}});
    }
    await save(project({scenes: scenes as never, voice: {engine: engine as never, voiceId: 'v1'}}));
  };
  const stubs = {render: (async (p) => p) as Step, package: (async (p) => p) as Step};

  it('synthesizes only the edited scene and leaves the other mp3s alone', async () => {
    await voiced('edge');
    const synthesize = vi.fn(async (_text: string) => new Uint8Array([9]));
    const engine = {name: 'edge', synthesize} as unknown as TtsEngine;
    await editNarration(dir, 's02', 'Nouveau texte.');
    const p = await rerender(dir, ctx(), {steps: {...stubs, voice: voiceStep({engine, probe: async () => 2})}});
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0]![0]).toBe('Nouveau texte.');
    const mtime = async (id: string) => (await fs.stat(path.join(dir, 'voice', id + '.mp3'))).mtimeMs;
    expect(await mtime('s01')).toBe(new Date(2020, 0, 1).getTime());
    expect(await mtime('s03')).toBe(new Date(2020, 0, 1).getTime());
    expect(await mtime('s02')).toBeGreaterThan(new Date(2021, 0, 1).getTime());
    expect(p.scenes[1]!.dirty).toBeUndefined();
    expect(p.scenes[1]!.audio!.seconds).toBe(2);
  });

  it('upload engine: the edited scene stays dirty with the stale-recording warning', async () => {
    await voiced('upload');
    await editNarration(dir, 's02', 'Nouveau texte.');
    const p = await rerender(dir, ctx(), {steps: {...stubs, voice: voiceStep()}});
    expect(p.scenes[1]).toMatchObject({dirty: true});
    expect(p.scenes[1]!.warnings).toContain(STALE_RECORDING_WARNING);
    expect(p.scenes[0]!.warnings).not.toContain(STALE_RECORDING_WARNING);
  });
});
