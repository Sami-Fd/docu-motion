import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {estimateDurationFrames} from '@docu-motion/scenes';
import type {StepContext} from '../../src/generate/context.js';
import {audioHash, voiceStep} from '../../src/generate/steps/voice.js';
import type {Project} from '../../src/project/schema.js';
import type {TtsEngine} from '../../src/voice/engines.js';

const invalidate = vi.hoisted(() => vi.fn());
vi.mock('../../src/render/bundle.js', () => ({invalidateBundle: invalidate}));

const scene = (id: string, narration: string, extra: Record<string, unknown> = {}) => ({
  id,
  narration,
  spec: {type: 'title', title: 'T', decor: 'none', characters: 0},
  status: 'ok',
  durationFrames: 1,
  factIds: [],
  warnings: [],
  ...extra,
});
const project = (
  engine: string,
  scenes: unknown[] = [scene('s01', 'Un deux trois.'), scene('s02', 'Quatre cinq six.'), scene('s03', 'Sept huit neuf.')],
): Project =>
  ({version: 1, brief: {language: 'fr'}, sources: [], facts: [], scenes, voice: {engine, voiceId: 'v1'}, progress: {done: []}}) as unknown as Project;

let dir: string;
const ctx = (extra: Partial<StepContext> = {}) =>
  ({projectDir: dir, settings: {keys: {openai: 'sk-secret-key-123'}}, onProgress: () => {}, ...extra}) as unknown as StepContext;
const probe = async () => 3.0;
const fakeEngine = (fail: (text: string) => boolean = () => false) => {
  const synthesize = vi.fn(async (text: string, _opts?: unknown) => {
    if (fail(text)) throw new Error('boom sk-secret-key-123');
    return new Uint8Array([1, 2, 3]);
  });
  return {engine: {name: 'edge', synthesize} as unknown as TtsEngine, synthesize};
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-unit-'));
  invalidate.mockClear();
});
afterEach(() => fs.rm(dir, {recursive: true, force: true}));

describe('voiceStep', () => {
  it('none: estimates durations and drops audio', async () => {
    const p = project('none', [scene('s01', 'Un deux trois quatre cinq.', {audio: {path: 'a.mp3', seconds: 3}})]);
    const out = await voiceStep()(p, ctx());
    expect(out.scenes[0]!.durationFrames).toBe(estimateDurationFrames('Un deux trois quatre cinq.'));
    expect(out.scenes[0]!.audio).toBeUndefined();
  });

  it('none: clears dirty on every scene', async () => {
    const p = project('none', [scene('s01', 'Un.', {dirty: true}), scene('s02', 'Deux.')]);
    const out = await voiceStep()(p, ctx());
    expect(out.scenes.map((s) => s.dirty)).toEqual([undefined, undefined]);
  });

  it('upload: a recording whose file is gone counts as no recording', async () => {
    await fs.mkdir(path.join(dir, 'voice'));
    await fs.writeFile(path.join(dir, 'voice', 's01.wav'), 'x');
    const p = project('upload', [
      scene('s01', 'Un.', {audio: {path: 'voice/s01.wav', seconds: 2}, durationFrames: 99}),
      scene('s02', 'Deux mots.', {audio: {path: 'voice/s02.wav', seconds: 2}, durationFrames: 99}),
    ]);
    const out = await voiceStep()(p, ctx());
    expect(out.scenes[0]!.audio).toBeDefined();
    expect(out.scenes[1]!.audio).toBeUndefined();
    expect(out.scenes[1]!.warnings).toEqual(['No recording for this scene']);
    expect(out.scenes[1]!.durationFrames).toBe(estimateDurationFrames('Deux mots.'));
  });

  describe('default voice resolution', () => {
    const ja = (voice: Record<string, unknown> = {engine: 'edge'}) =>
      ({...project('edge'), brief: {language: 'ja'}, voice}) as unknown as Project;
    const client = () => ({
      synthesize: vi.fn(),
      listVoices: vi.fn(async () => [{ShortName: 'ja-JP-NanamiNeural', Locale: 'ja-JP'}]),
    });

    it('persists the resolved default with its engine, then a cached run needs no network', async () => {
      const {engine, synthesize} = fakeEngine();
      const edgeClient = client();
      const first = await voiceStep({engine, probe, edgeClient})(ja(), ctx());
      expect(first.voice).toMatchObject({engine: 'edge', resolvedVoiceId: 'ja-JP-NanamiNeural', resolvedEngine: 'edge'});
      expect(first.voice.voiceId).toBeUndefined();
      expect(edgeClient.listVoices).toHaveBeenCalledTimes(1);
      synthesize.mockClear();
      const offline = {
        synthesize: vi.fn(),
        listVoices: vi.fn(async () => {
          throw new Error('offline');
        }),
      };
      const again = await voiceStep({engine, probe, edgeClient: offline})(first, ctx());
      expect(synthesize).not.toHaveBeenCalled();
      expect(offline.listVoices).not.toHaveBeenCalled();
      expect(again.scenes.every((s) => !s.warnings.length)).toBe(true);
    });

    it('does not list voices when the project has a voice id', async () => {
      const edgeClient = client();
      await voiceStep({engine: fakeEngine().engine, probe, edgeClient})(ja({engine: 'edge', voiceId: 'x'}), ctx());
      expect(edgeClient.listVoices).not.toHaveBeenCalled();
    });

    it('ignores a resolved id that belongs to another engine', async () => {
      const {engine, synthesize} = fakeEngine();
      const stale = ja({engine: 'openai', resolvedVoiceId: 'ja-JP-NanamiNeural', resolvedEngine: 'edge'});
      const out = await voiceStep({engine, probe})(stale, ctx());
      expect(synthesize.mock.calls[0]![1]).toMatchObject({voiceId: 'alloy'});
      expect(out.voice).toMatchObject({resolvedVoiceId: 'alloy', resolvedEngine: 'openai'});
    });

    it('an injected engine without a client never lists voices over the network', async () => {
      const {engine, synthesize} = fakeEngine();
      await voiceStep({engine, probe})(ja(), ctx());
      expect(synthesize).toHaveBeenCalledTimes(3);
    });
  });

  it('synthesizes, probes and caches', async () => {
    const {engine, synthesize} = fakeEngine();
    const step = voiceStep({engine, probe});
    const out = await step(project('edge'), ctx());
    for (const s of out.scenes) {
      expect(s.durationFrames).toBe(126);
      expect(s.audio).toEqual({path: `voice/${s.id}.mp3`, seconds: 3, hash: audioHash(s.narration, 'edge', 'v1')});
    }
    expect(audioHash('x', 'edge', 'v1')).toMatch(/^[0-9a-f]{16}$/);
    expect(synthesize).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledTimes(1);
    const file = path.join(dir, 'voice', 's01.mp3');
    const before = (await fs.stat(file)).mtimeMs;
    const again = await step(out, ctx());
    expect(synthesize).toHaveBeenCalledTimes(3);
    expect((await fs.stat(file)).mtimeMs).toBe(before);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(again.scenes.map((s) => s.durationFrames)).toEqual([126, 126, 126]);
  });

  it('re-synthesizes only the edited scene', async () => {
    const {engine, synthesize} = fakeEngine();
    const step = voiceStep({engine, probe});
    const out = await step(project('edge'), ctx());
    synthesize.mockClear();
    const edited = {...out, scenes: out.scenes.map((s, i) => (i === 1 ? {...s, narration: 'Autre texte ici.', dirty: true} : s))};
    const res = await step(edited, ctx());
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(res.scenes[1]!.dirty).toBeUndefined();
  });

  it('a failing scene is estimated with a redacted warning; others keep audio', async () => {
    const {engine} = fakeEngine((t) => t.startsWith('Quatre'));
    const out = await voiceStep({engine, probe})(project('openai'), ctx());
    expect(out.scenes[1]!.audio).toBeUndefined();
    expect(out.scenes[1]!.durationFrames).toBe(estimateDurationFrames('Quatre cinq six.'));
    expect(out.scenes[1]!.warnings).toEqual(['Voice failed: boom ***']);
    expect(out.scenes[0]!.audio).toBeDefined();
    expect(out.scenes[2]!.audio).toBeDefined();
    const ok = fakeEngine();
    const fixed = await voiceStep({engine: ok.engine, probe})(out, ctx());
    expect(fixed.scenes[1]!.warnings).toEqual([]);
    expect(ok.synthesize).toHaveBeenCalledTimes(1);
  });

  it('rejects when every scene fails', async () => {
    const {engine} = fakeEngine(() => true);
    await expect(voiceStep({engine, probe})(project('edge'), ctx())).rejects.toThrow('Voice engine "edge" failed for every scene: boom');
  });

  it('propagates an abort instead of recording a failure', async () => {
    const ac = new AbortController();
    const engine = {
      name: 'edge',
      synthesize: async () => {
        ac.abort();
        throw Object.assign(new Error('aborted'), {name: 'AbortError'});
      },
    } as unknown as TtsEngine;
    await expect(voiceStep({engine, probe})(project('edge'), ctx({signal: ac.signal}))).rejects.toThrow('aborted');
  });

  it('upload: warns for a missing recording, keeps audio, flags a dirty scene', async () => {
    await fs.mkdir(path.join(dir, 'voice'));
    for (const f of ['s01', 's02']) await fs.writeFile(path.join(dir, 'voice', f + '.wav'), 'x');
    const p = project('upload', [
      scene('s01', 'Un.', {audio: {path: 'voice/s01.wav', seconds: 2}, durationFrames: 99}),
      scene('s02', 'Deux.', {audio: {path: 'voice/s02.wav', seconds: 2}, durationFrames: 99, dirty: true}),
      scene('s03', 'Trois.'),
    ]);
    const out = await voiceStep()(p, ctx());
    expect(out.scenes[0]!.durationFrames).toBe(99);
    expect(out.scenes[1]!.audio).toBeDefined();
    expect(out.scenes[1]!.warnings[0]).toContain('Narration edited after recording');
    expect(out.scenes[2]!.warnings).toEqual(['No recording for this scene']);
    expect(out.scenes[2]!.durationFrames).toBe(estimateDurationFrames('Trois.'));
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('clears warnings of other engine branches, keeps unrelated ones', async () => {
    const other = 'Layout may overflow the frame';
    const p = project('upload', [
      scene('s01', 'Un deux trois.', {warnings: [other, 'Voice failed: x']}),
      scene('s02', 'Quatre.', {audio: {path: 'voice/s02.wav', seconds: 2}, dirty: true, warnings: [other]}),
    ]);
    const up = await voiceStep()(p, ctx());
    expect(up.scenes[0]!.warnings).toEqual([other, 'No recording for this scene']);
    expect(up.scenes[1]!.warnings[0]).toBe(other);
    const edge = await voiceStep({engine: fakeEngine().engine, probe})({...up, voice: {engine: 'edge', voiceId: 'v1'}}, ctx());
    expect(edge.scenes.map((s) => s.warnings)).toEqual([[other], [other]]);
    const none = await voiceStep()({...up, voice: {engine: 'none'}}, ctx());
    expect(none.scenes.map((s) => s.warnings)).toEqual([[other], [other]]);
  });

  it('resynthesizes when the hash matches but the file is gone', async () => {
    const {engine, synthesize} = fakeEngine();
    const step = voiceStep({engine, probe});
    const out = await step(project('edge'), ctx());
    await fs.rm(path.join(dir, 'voice', 's02.mp3'));
    synthesize.mockClear();
    await step(out, ctx());
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('reports progress as (i+1)/n', async () => {
    const ratios: number[] = [];
    await voiceStep({engine: fakeEngine().engine, probe})(project('edge'), ctx({onProgress: (e) => void (e.ratio !== undefined && ratios.push(e.ratio))}));
    expect(ratios).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('invalidates the bundle even when the run aborts after a write', async () => {
    const ac = new AbortController();
    let calls = 0;
    const engine = {
      name: 'edge',
      synthesize: async () => {
        if (++calls === 2) {
          ac.abort();
          throw Object.assign(new Error('aborted'), {name: 'AbortError'});
        }
        return new Uint8Array([1]);
      },
    } as unknown as TtsEngine;
    await expect(voiceStep({engine, probe})(project('edge'), ctx({signal: ac.signal}))).rejects.toThrow();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect((await fs.readdir(path.join(dir, 'voice'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
