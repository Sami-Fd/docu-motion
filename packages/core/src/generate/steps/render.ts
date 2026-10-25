import {probeMedia} from '../../render/probe.js';
import {renderVideo} from '../../render/render.js';
import type {Step} from '../context.js';

const FPS = 30;
const TOLERANCE_SECONDS = 0.2;

export const renderStep: Step = async (p, ctx) => {
  ctx.signal?.throwIfAborted();
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
