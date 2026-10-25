import {estimateDurationFrames} from '@docu-motion/scenes';
import type {Step} from '../context.js';

export const voiceStep: Step = async (p, ctx) => {
  ctx.signal?.throwIfAborted();
  if (p.voice.engine !== 'none') throw new Error(`Voice engine "${p.voice.engine}" arrives in Plan 3`);
  const scenes = p.scenes.map(({audio: _audio, ...s}) => ({...s, durationFrames: estimateDurationFrames(s.narration)}));
  ctx.onProgress({step: 'voice', ratio: 1});
  return {...p, scenes};
};
