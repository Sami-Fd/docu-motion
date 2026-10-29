// Pieces shared by scripts/make.ts and scripts/touch.ts.
// Test-only hooks, read only here (R2: core never reads the env; the scripts inject the engines):
//   DOCU_MOTION_FAKE_TTS=1         the voice step uses the offline 440 Hz tone engine (words / 2.5 s) instead of a real TTS.
//   DOCU_MOTION_TTS_UNREACHABLE=1  the voice step uses the real Edge engine code (retries included) over a client that always
//                                  fails with a transient network error (EAI_AGAIN), as when offline.
import path from 'node:path';
import {
  createFakeTtsEngine,
  createTtsEngine,
  voiceStep,
  type Settings,
  type Step,
  type StepName,
} from '../packages/core/src/index.js';

export class UsageError extends Error {}
export const usage = (message: string): never => {
  throw new UsageError(message);
};

export const fakeTtsEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.DOCU_MOTION_FAKE_TTS === '1';

/** The `steps` override for the test hooks above; empty when none is set. */
export function testTtsSteps(env: NodeJS.ProcessEnv = process.env): Partial<Record<StepName, Step>> {
  if (fakeTtsEnabled(env)) return {voice: voiceStep({engine: createFakeTtsEngine()})};
  if (env.DOCU_MOTION_TTS_UNREACHABLE === '1') {
    const offline = async (): Promise<never> => {
      throw new Error('getaddrinfo EAI_AGAIN speech.platform.bing.com');
    };
    return {voice: voiceStep({engine: createTtsEngine('edge', {keys: {}} as Settings, {edgeClient: {synthesize: offline, listVoices: offline}})})};
  }
  return {};
}

export function reportPaths(projectDir: string, thumbnailFile: string | undefined): string[] {
  return [
    ...(thumbnailFile ? [`Thumbnail: ${path.join(projectDir, thumbnailFile)}`] : []),
    `YouTube: ${path.join(projectDir, 'out', 'youtube.txt')}`,
  ];
}

/** Printed after a failed voice step: the way out is a different voice, not another resume with the same one. */
export const voiceFailureHint = (projectDir: string): string =>
  `Check --voice-id if you gave one. To change the voice: npm run touch -- "${projectDir}" voice <edge|elevenlabs|openai|none> [--voice-id <id>]`;

/**
 * Runs a CLI main(): the exit code starts at 1 and only becomes the returned code when main settles, so a process that
 * runs out of work while main is still pending can never exit 0. `onError` prints the error and returns the exit code.
 */
export function runCli(main: () => Promise<number>, onError: (e: unknown) => number): void {
  process.exitCode = 1;
  let settled = false;
  process.on('beforeExit', () => {
    if (!settled) {
      console.error('FAILED: the process stopped unexpectedly');
      process.exitCode = 1;
    }
  });
  main().then(
    (code) => {
      settled = true;
      process.exit(code);
    },
    (e) => {
      settled = true;
      process.exit(onError(e));
    },
  );
}
