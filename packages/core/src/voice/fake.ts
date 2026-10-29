import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runRemotionTool} from '../media/ffmpeg.js';
import type {TtsEngine} from './engines.js';

/**
 * Test-only engine: a 440 Hz tone lasting words / 2.5 seconds, as MP3, rendered by ffmpeg's lavfi source.
 * No network. Core never reads an env var for it: scripts/cli-common.ts injects it (see fakeTtsEnabled there).
 */
export function createFakeTtsEngine(): TtsEngine {
  return {
    name: 'edge',
    async synthesize(text, {signal}) {
      const trimmed = text.trim();
      const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
      const seconds = Math.max(0.2, words / 2.5);
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-tts-'));
      try {
        const out = path.join(dir, 'tone.mp3');
        await runRemotionTool(
          'ffmpeg',
          ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'libmp3lame', out],
          {signal},
        );
        return new Uint8Array(await fs.readFile(out));
      } finally {
        await fs.rm(dir, {recursive: true, force: true});
      }
    },
  };
}
