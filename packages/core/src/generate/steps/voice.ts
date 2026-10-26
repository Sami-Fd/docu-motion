import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {durationFromAudio, estimateDurationFrames} from '@docu-motion/scenes';
import {redact} from '../../llm/redact.js';
import {probeAudioSeconds} from '../../media/ffmpeg.js';
import type {Project} from '../../project/schema.js';
import {invalidateBundle} from '../../render/bundle.js';
import {createTtsEngine, defaultVoiceFor, type TtsEngine} from '../../voice/engines.js';
import type {Step} from '../context.js';

export const VOICE_FAILED = 'Voice failed: ';
export const NO_RECORDING_WARNING = 'No recording for this scene';
export const STALE_RECORDING_WARNING = 'Narration edited after recording — record again or switch to a TTS voice';

/** First 16 hex characters of sha256 over the text, the engine and the voice: the cache key of a scene's audio. */
export function audioHash(text: string, engine: string, voiceId: string): string {
  return createHash('sha256').update(JSON.stringify([text, engine, voiceId])).digest('hex').slice(0, 16);
}

type Scene = Project['scenes'][number];
const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || e.name === 'GenerateCancelled');

/**
 * `engine` replaces the engine built from the settings (tests, and scripts/make.ts for the fake TTS);
 * `probe` replaces the ffprobe duration reader.
 */
export function voiceStep(deps: {engine?: TtsEngine; probe?: (file: string) => Promise<number>} = {}): Step {
  const probe = deps.probe ?? probeAudioSeconds;
  return async (p, ctx) => {
    ctx.signal?.throwIfAborted();
    const n = p.scenes.length;
    const kind = p.voice.engine;

    if (kind === 'none') {
      const scenes = p.scenes.map(({audio: _audio, ...s}) => ({...s, durationFrames: estimateDurationFrames(s.narration)}));
      ctx.onProgress({step: 'voice', ratio: 1});
      return {...p, scenes};
    }

    if (kind === 'upload') {
      const own = [NO_RECORDING_WARNING, STALE_RECORDING_WARNING];
      const scenes = p.scenes.map((s): Scene => {
        const warnings = s.warnings.filter((w) => !own.includes(w));
        if (!s.audio) {
          return {...s, durationFrames: estimateDurationFrames(s.narration), warnings: [...warnings, NO_RECORDING_WARNING]};
        }
        return {...s, warnings: s.dirty ? [...warnings, STALE_RECORDING_WARNING] : warnings};
      });
      ctx.onProgress({step: 'voice', ratio: 1});
      return {...p, scenes};
    }

    const secrets = Object.values(ctx.settings.keys).filter((v): v is string => typeof v === 'string' && v.length > 0);
    const engine = deps.engine ?? createTtsEngine(kind, ctx.settings, {fetch: ctx.fetch});
    const voiceId = p.voice.voiceId ?? (await defaultVoiceFor(kind, p.brief.language));
    const results: Scene[] = [];
    let wrote = false;
    let failures = 0;
    let firstCause = '';

    for (let i = 0; i < n; i++) {
      ctx.signal?.throwIfAborted();
      const s = p.scenes[i]!;
      const warnings = s.warnings.filter((w) => !w.startsWith(VOICE_FAILED));
      const hash = audioHash(s.narration, kind, voiceId);
      if (s.audio?.hash === hash && existsSync(path.join(ctx.projectDir, s.audio.path))) {
        const {dirty: _dirty, ...rest} = s;
        results.push({...rest, durationFrames: durationFromAudio(s.audio.seconds), warnings});
      } else {
        const rel = `voice/${s.id}.mp3`;
        const file = path.join(ctx.projectDir, 'voice', `${s.id}.mp3`);
        try {
          const bytes = await engine.synthesize(s.narration, {voiceId, signal: ctx.signal});
          await fs.mkdir(path.dirname(file), {recursive: true});
          await fs.writeFile(file, bytes);
          wrote = true;
          const seconds = await probe(file);
          const {dirty: _dirty, ...rest} = s;
          results.push({...rest, audio: {path: rel, seconds, hash}, durationFrames: durationFromAudio(seconds), warnings});
        } catch (e) {
          if (ctx.signal?.aborted || isAbort(e)) throw e;
          const cause = redact(e instanceof Error ? e.message : String(e), secrets);
          if (failures++ === 0) firstCause = cause;
          const {audio: _audio, ...rest} = s;
          results.push({
            ...rest,
            durationFrames: estimateDurationFrames(s.narration),
            warnings: [...warnings, `${VOICE_FAILED}${cause}`],
          });
        }
      }
      ctx.onProgress({step: 'voice', ratio: (i + 1) / n});
    }

    if (wrote) invalidateBundle(ctx.projectDir);
    if (n > 0 && failures === n) throw new Error(`Voice engine "${kind}" failed for every scene: ${firstCause}`);
    return {...p, scenes: results};
  };
}
