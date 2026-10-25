import {describe, expect, it} from 'vitest';
import {estimateDurationFrames} from '@docu-motion/scenes';
import type {StepContext} from '../../src/generate/context.js';
import {voiceStep} from '../../src/generate/steps/voice.js';
import type {Project} from '../../src/project/schema.js';

const project = (engine: string): Project =>
  ({
    version: 1,
    brief: {},
    sources: [],
    facts: [],
    scenes: [
      {id: 's01', narration: 'Un deux trois quatre cinq.', spec: {type: 'title', title: 'T', decor: 'none', characters: 0}, status: 'ok', durationFrames: 1, audio: {path: 'a.mp3', seconds: 3}, factIds: [], warnings: []},
    ],
    voice: {engine},
    progress: {done: []},
  }) as unknown as Project;
const ctx = {onProgress: () => {}} as unknown as StepContext;

describe('voiceStep', () => {
  it('none: estimates durations and drops audio', async () => {
    const out = await voiceStep(project('none'), ctx);
    expect(out.scenes[0]!.durationFrames).toBe(estimateDurationFrames('Un deux trois quatre cinq.'));
    expect(out.scenes[0]!.audio).toBeUndefined();
  });
  it('other engines arrive in Plan 3', async () => {
    await expect(voiceStep(project('edge'), ctx)).rejects.toThrow('Plan 3');
  });
});
