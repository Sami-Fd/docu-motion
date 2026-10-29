import {existsSync} from 'node:fs';
import path from 'node:path';
import {probeMedia} from '../../render/probe.js';
import {renderVideo} from '../../render/render.js';
import type {Step} from '../context.js';

const FPS = 30;
const TOLERANCE_SECONDS = 0.2;

export const renderStep: Step = async (p, ctx) => {
  ctx.signal?.throwIfAborted();
  // A scene with audio whose file is gone would render silent: stop with the way out instead.
  for (const s of p.scenes) {
    if (s.audio && !existsSync(path.join(ctx.projectDir, s.audio.path))) {
      throw new Error(`Audio for ${s.id} is missing (${s.audio.path}) — run "rerender" to re-voice or record again`);
    }
  }
  const file = await renderVideo(ctx.projectDir, p, {
    onProgress: (ratio) => ctx.onProgress({step: 'render', ratio}),
    signal: ctx.signal,
  });
  const info = await probeMedia(file);
  const expected = p.scenes.reduce((sum, s) => sum + s.durationFrames, 0) / FPS;
  if (Math.abs(info.durationSeconds - expected) > TOLERANCE_SECONDS) {
    throw new Error(`Rendered duration ${info.durationSeconds.toFixed(1)}s does not match ${expected.toFixed(1)}s`);
  }
  return p;
};
