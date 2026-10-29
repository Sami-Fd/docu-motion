import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {durationFromAudio, estimateDurationFrames} from '@docu-motion/scenes';
import {redact} from '../../llm/redact.js';
import {probeAudioSeconds} from '../../media/ffmpeg.js';
import type {Project} from '../../project/schema.js';
import {invalidateBundle} from '../../render/bundle.js';
import {createTtsEngine, defaultVoiceFor, type EdgeClient, type TtsEngine} from '../../voice/engines.js';
import type {Step} from '../context.js';

export const VOICE_FAILED = 'Voice failed: ';
export const NO_RECORDING_WARNING = 'No recording for this scene';
export const STALE_RECORDING_WARNING = 'Narration edited after recording — record again or switch to a TTS voice';

/** First 16 hex characters of sha256 over the text, the engine and the voice: the cache key of a scene's audio. */
export function audioHash(text: string, engine: string, voiceId: string): string {
  return createHash('sha256').update(JSON.stringify([text, engine, voiceId])).digest('hex').slice(0, 16);
}

type Scene = Project['scenes'][number];
/** Drops every warning any voice branch can set, so a switch of engine never leaves a stale one behind. */
const stripVoiceWarnings = (w: string[]) =>
  w.filter((x) => !x.startsWith(VOICE_FAILED) && x !== NO_RECORDING_WARNING && x !== STALE_RECORDING_WARNING);
const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || e.name === 'GenerateCancelled');

/**
 * `engine` replaces the engine built from the settings (tests, and scripts/make.ts for the fake TTS);
 * `probe` replaces the ffprobe duration reader; `edgeClient` is used for the Edge engine and for the voice-list lookup
 * of a language without a built-in default (an injected `engine` with no `edgeClient` never reaches the network for it).
 */
export function voiceStep(
  deps: {engine?: TtsEngine; probe?: (file: string) => Promise<number>; edgeClient?: EdgeClient} = {},
): Step {
  const probe = deps.probe ?? probeAudioSeconds;
  return async (p, ctx) => {
    ctx.signal?.throwIfAborted();
    const n = p.scenes.length;
    const kind = p.voice.engine;

    if (kind === 'none') {
      const scenes = p.scenes.map(({audio: _audio, dirty: _dirty, ...s}) => ({
        ...s,
        durationFrames: estimateDurationFrames(s.narration),
        warnings: stripVoiceWarnings(s.warnings),
      }));
      ctx.onProgress({step: 'voice', ratio: 1});
      return {...p, scenes};
    }

    if (kind === 'upload') {
      const scenes = p.scenes.map((s): Scene => {
        const warnings = stripVoiceWarnings(s.warnings);
        // A recording whose file is gone is no recording: estimate the length and say so.
        if (!s.audio || !existsSync(path.join(ctx.projectDir, s.audio.path))) {
          const {audio: _audio, ...noAudio} = s;
          return {...noAudio, durationFrames: estimateDurationFrames(s.narration), warnings: [...warnings, NO_RECORDING_WARNING]};
        }
        return {...s, warnings: s.dirty ? [...warnings, STALE_RECORDING_WARNING] : warnings};
      });
      ctx.onProgress({step: 'voice', ratio: 1});
      return {...p, scenes};
    }

    const secrets = Object.values(ctx.settings.keys).filter((v): v is string => typeof v === 'string' && v.length > 0);
    const engine = deps.engine ?? createTtsEngine(kind, ctx.settings, {fetch: ctx.fetch, edgeClient: deps.edgeClient});
    // A voice found earlier (explicit, or the resolved default of this very engine) is used without any lookup.
    const known = p.voice.voiceId ?? (p.voice.resolvedEngine === kind ? p.voice.resolvedVoiceId : undefined);
    const lookupClient: EdgeClient | undefined =
      deps.edgeClient ??
      (deps.engine
        ? {
            synthesize: async () => new Uint8Array(),
            listVoices: async () => [{Locale: `${p.brief.language.toLowerCase().split(/[-_]/)[0]}-XX`, ShortName: 'injected-default'}],
          }
        : undefined);
    let resolved: string | undefined;
    let voicePromise: Promise<string> | undefined;
    const resolveVoice = () =>
      known
        ? Promise.resolve(known)
        : (voicePromise ??= defaultVoiceFor(kind, p.brief.language, {edgeClient: lookupClient}).then((v) => (resolved = v)));
    const results: Scene[] = [];
    let wrote = false;
    let failures = 0;
    let firstCause = '';

    try {
      for (let i = 0; i < n; i++) {
        ctx.signal?.throwIfAborted();
        const s = p.scenes[i]!;
        const warnings = stripVoiceWarnings(s.warnings);
        const {dirty: _dirty, ...rest} = s;
        try {
          const voiceId = await resolveVoice();
          const hash = audioHash(s.narration, kind, voiceId);
          if (s.audio?.hash === hash && existsSync(path.join(ctx.projectDir, s.audio.path))) {
            results.push({...rest, durationFrames: durationFromAudio(s.audio.seconds), warnings});
          } else {
            const file = path.join(ctx.projectDir, 'voice', `${s.id}.mp3`);
            const bytes = await engine.synthesize(s.narration, {voiceId, signal: ctx.signal});
            await fs.mkdir(path.dirname(file), {recursive: true});
            // Write then rename: an interrupted write never leaves a truncated file the cache would trust.
            await fs.writeFile(`${file}.tmp`, bytes);
            await fs.rename(`${file}.tmp`, file);
            wrote = true;
            const seconds = await probe(file);
            results.push({...rest, audio: {path: `voice/${s.id}.mp3`, seconds, hash}, durationFrames: durationFromAudio(seconds), warnings});
          }
        } catch (e) {
          if (ctx.signal?.aborted || isAbort(e)) throw e;
          const cause = redact(e instanceof Error ? e.message : String(e), secrets);
          if (failures++ === 0) firstCause = cause;
          const {audio: _audio, ...noAudio} = rest;
          results.push({
            ...noAudio,
            durationFrames: estimateDurationFrames(s.narration),
            warnings: [...warnings, `${VOICE_FAILED}${cause}`],
          });
        }
        ctx.onProgress({step: 'voice', ratio: (i + 1) / n});
      }
      if (n > 0 && failures === n) throw new Error(`Voice engine "${kind}" failed for every scene: ${firstCause}`);
    } finally {
      if (wrote) invalidateBundle(ctx.projectDir);
    }
    const voice = resolved && !p.voice.voiceId ? {...p.voice, resolvedVoiceId: resolved, resolvedEngine: kind} : p.voice;
    return {...p, voice, scenes: results};
  };
}
