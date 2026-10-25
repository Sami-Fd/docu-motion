import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {Step, StepContext} from '../../src/generate/context.js';
import {GenerateCancelled, generate, StepFailedError, STEPS} from '../../src/generate/generate.js';
import {createFakeProvider} from '../../src/llm/fake.js';
import {STEP_NAMES, type Project, type StepName} from '../../src/project/schema.js';
import {loadProject, saveProject} from '../../src/project/store.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const base = {
  version: 1,
  brief: {topic: 'T', language: 'en', targetMinutes: 2, style: 'papier', provider: {kind: 'fake', provider: 'fake'}, webSearch: 'off', sources: []},
  sources: [],
  facts: [],
  scenes: [],
  voice: {engine: 'none'},
  progress: {done: []},
} as unknown as Project;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gen-'));
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

function ctx(over: Partial<Omit<StepContext, 'projectDir'>> = {}) {
  return {
    llm: createFakeProvider(() => ({})),
    settings: SettingsSchema.parse({}),
    fetch: (async () => new Response('')) as unknown as typeof fetch,
    onProgress: () => {},
    ...over,
  };
}

function stubs(calls: string[], over: Partial<Record<StepName, Step>> = {}) {
  const out = {} as Record<StepName, Step>;
  for (const name of STEP_NAMES) {
    out[name] =
      over[name] ??
      (async (p, c) => {
        calls.push(name);
        // Earlier steps must already be checkpointed on disk before this one runs.
        expect((await loadProject(c.projectDir)).progress.done).toEqual(STEP_NAMES.slice(0, STEP_NAMES.indexOf(name)));
        return {...p, facts: [...p.facts, {id: name, statement: name, verified: true}]};
      });
  }
  return out;
}

describe('generate', () => {
  it('runs the 7 steps in order, checkpointing after each', async () => {
    await saveProject(dir, base);
    const calls: string[] = [];
    const events: string[] = [];
    const p = await generate(dir, ctx({onProgress: (e) => e.ratio === 1 && events.push(e.step)}), {steps: stubs(calls)});
    expect(calls).toEqual([...STEP_NAMES]);
    expect(events).toEqual([...STEP_NAMES]);
    expect(p.progress.done).toEqual([...STEP_NAMES]);
    expect((await loadProject(dir)).facts).toHaveLength(7);
  });

  it('has a real step for every name', () => {
    expect(Object.keys(STEPS)).toEqual([...STEP_NAMES]);
  });

  it('resumes after a failure without re-running finished steps', async () => {
    await saveProject(dir, base);
    const calls: string[] = [];
    const boom: Step = async () => {
      throw new Error('boom');
    };
    const err = await generate(dir, ctx(), {steps: stubs(calls, {script: boom})}).catch((e) => e);
    expect(err).toBeInstanceOf(StepFailedError);
    expect(err.step).toBe('script');
    const saved = await loadProject(dir);
    expect(saved.progress.failed).toEqual({step: 'script', message: 'boom'});
    expect(saved.progress.done).toEqual(['sources', 'facts']);

    calls.length = 0;
    const p = await generate(dir, ctx(), {steps: stubs(calls)});
    expect(calls).toEqual(['script', 'scenes', 'voice', 'layout', 'render']);
    expect(p.progress.failed).toBeUndefined();
    expect((await loadProject(dir)).progress.failed).toBeUndefined();
  });

  it('cancel: not recorded as failed, done keeps finished steps', async () => {
    await saveProject(dir, base);
    const ac = new AbortController();
    const abortInFacts: Step = async (_p, c) => {
      ac.abort();
      c.signal?.throwIfAborted();
      throw new Error('unreachable');
    };
    const err = await generate(dir, ctx({signal: ac.signal}), {steps: stubs([], {facts: abortInFacts})}).catch((e) => e);
    expect(err).toBeInstanceOf(GenerateCancelled);
    expect(err.name).toBe('GenerateCancelled');
    const saved = await loadProject(dir);
    expect(saved.progress.failed).toBeUndefined();
    expect(saved.progress.done).toEqual(['sources']);
  });

  it('an AbortError thrown by a step maps to GenerateCancelled', async () => {
    await saveProject(dir, base);
    const abortErr: Step = async () => {
      throw Object.assign(new Error('aborted'), {name: 'AbortError'});
    };
    await expect(generate(dir, ctx(), {steps: stubs([], {sources: abortErr})})).rejects.toBeInstanceOf(GenerateCancelled);
    expect((await loadProject(dir)).progress.failed).toBeUndefined();
  });

  it('checks the signal before each step', async () => {
    await saveProject(dir, base);
    const ac = new AbortController();
    ac.abort();
    const calls: string[] = [];
    await expect(generate(dir, ctx({signal: ac.signal}), {steps: stubs(calls)})).rejects.toBeInstanceOf(GenerateCancelled);
    expect(calls).toEqual([]);
  });

  it('redacts configured keys from the saved failure message', async () => {
    await saveProject(dir, base);
    const key = 'sk-secret-key-12345';
    const leak: Step = async () => {
      throw new Error(`bad request with ${key}`);
    };
    const settings = SettingsSchema.parse({keys: {anthropic: key}});
    const err = await generate(dir, ctx({settings}), {steps: stubs([], {sources: leak})}).catch((e) => e);
    expect(err.message).not.toContain(key);
    const saved = await loadProject(dir);
    expect(saved.progress.failed!.message).toBe('bad request with ***');
    expect(JSON.stringify(saved)).not.toContain(key);
  });
});
