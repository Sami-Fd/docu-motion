// Pieces shared by scripts/make.ts and scripts/touch.ts.
// Test-only hook: DOCU_MOTION_FAKE_TTS=1 makes the voice step use the offline 440 Hz tone engine
// (words / 2.5 s) instead of a real TTS. Core never reads it (R2): the scripts read it and inject the engine here.
import path from 'node:path';
import {createFakeTtsEngine, voiceStep, type Step, type StepName} from '../packages/core/src/index.js';

export class UsageError extends Error {}
export const usage = (message: string): never => {
  throw new UsageError(message);
};

/** The `steps` override that swaps in the fake TTS when DOCU_MOTION_FAKE_TTS=1; empty otherwise. */
export function fakeTtsSteps(env: NodeJS.ProcessEnv = process.env): Partial<Record<StepName, Step>> {
  return env.DOCU_MOTION_FAKE_TTS === '1' ? {voice: voiceStep({engine: createFakeTtsEngine()})} : {};
}

export function reportPaths(projectDir: string, thumbnailFile: string | undefined): string[] {
  return [
    ...(thumbnailFile ? [`Thumbnail: ${path.join(projectDir, thumbnailFile)}`] : []),
    `YouTube: ${path.join(projectDir, 'out', 'youtube.txt')}`,
  ];
}
