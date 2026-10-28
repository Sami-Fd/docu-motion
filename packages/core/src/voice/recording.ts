import {promises as fs} from 'node:fs';
import path from 'node:path';
import {durationFromAudio} from '@docu-motion/scenes';
import {STALE_RECORDING_WARNING, NO_RECORDING_WARNING, VOICE_FAILED} from '../generate/steps/voice.js';
import {cutAudio, probeAudioSeconds, runRemotionTool} from '../media/ffmpeg.js';
import {detectSilences, segmentsFromCuts, segmentsFromSilences, type Silence} from '../media/silence.js';
import type {Project, StepName} from '../project/schema.js';
import {loadProject, saveProject} from '../project/store.js';
import {invalidateBundle} from '../render/bundle.js';

const BREAK = '\n<break time="2.0s" />\n';

/** Writes the text to read aloud (narrations only, 2 s pause markers between scenes) and returns its path. */
export async function prepareRecording(projectDir: string): Promise<string> {
  const p = await loadProject(projectDir);
  const file = path.join(projectDir, 'out', 'recording-script.txt');
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, p.scenes.map((s) => s.narration).join(BREAK), 'utf8');
  return file;
}

export type ApplyRecordingResult =
  | {ok: true; project: Project}
  | {ok: false; found: number; needed: number; silences: Silence[]; suggested: number[]; hint?: string};

async function assertHasAudio(file: string, signal?: AbortSignal): Promise<void> {
  let out: string;
  try {
    out = (await runRemotionTool('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], {signal})).stdout;
  } catch (e) {
    throw new Error(`Could not read the recording ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const streams = (JSON.parse(out) as {streams?: {codec_type?: string}[]}).streams ?? [];
  if (!streams.some((s) => s.codec_type === 'audio')) throw new Error(`The file ${file} has no audio stream`);
}

function checkCuts(cuts: number[], needed: number, duration: number): void {
  if (cuts.length !== needed) throw new Error(`Expected ${needed} cut time(s) for ${needed + 1} scenes, got ${cuts.length}`);
  cuts.forEach((c, i) => {
    if (!Number.isFinite(c) || c <= 0 || c >= duration) {
      throw new Error(`Cut time ${c} is outside the recording duration (0 – ${duration.toFixed(2)} s)`);
    }
    if (i > 0 && c <= cuts[i - 1]!) throw new Error('Cut times must be strictly increasing');
  });
}

const DROP: StepName[] = ['voice', 'render', 'package'];

const rmQuiet = async (f: string) => {
  try {
    await fs.rm(f, {force: true});
  } catch {
    // best effort
  }
};
const exists = (f: string) => fs.stat(f).then(() => true, () => false);

/**
 * Splits a recording into one wav per scene and switches the project to the `upload` voice.
 *
 * All-or-nothing: every cut goes to a temp file and the recording is copied to a temp file first. Only when
 * all of that succeeded are the current files moved to `.bak`, the new ones renamed in and project.json
 * saved; a failure in that tail restores the `.bak` files. Cleanup after the save is best-effort.
 * Detected silences give padded segments (see segmentsFromSilences); explicit `cuts` are exact.
 */
export async function applyRecording(
  projectDir: string,
  file: string,
  opts: {cuts?: number[]; signal?: AbortSignal; noiseDb?: number; minSilence?: number} = {},
): Promise<ApplyRecordingResult> {
  const {signal} = opts;
  signal?.throwIfAborted();
  const p = await loadProject(projectDir);
  const n = p.scenes.length;
  if (n === 0) throw new Error('The project has no scenes to split a recording into');
  await assertHasAudio(file, signal);
  signal?.throwIfAborted();

  const det = await detectSilences(file, {noiseDb: opts.noiseDb, minSeconds: opts.minSilence, signal});
  const {silences, duration, soundStart, soundEnd} = det;
  if (soundEnd <= soundStart) throw new Error(`The recording ${file} is silent`);
  let segments: [number, number][];
  if (opts.cuts) {
    checkCuts(opts.cuts, n - 1, duration);
    segments = segmentsFromCuts(opts.cuts, soundStart, soundEnd, duration);
  } else if (n === 1) {
    segments = segmentsFromSilences([], soundStart, soundEnd, duration, 1);
  } else if (silences.length === n - 1) {
    segments = segmentsFromSilences(silences, soundStart, soundEnd, duration, n);
  } else {
    const found = silences.length;
    const suggested =
      found > n - 1
        ? [...silences]
            .sort((a, b) => b.end - b.start - (a.end - a.start))
            .slice(0, n - 1)
            .sort((a, b) => a.start - b.start)
            .map((x) => (x.start + x.end) / 2)
        : [];
    return {
      ok: false,
      found,
      needed: n - 1,
      silences,
      suggested,
      ...(found === 0
        ? {hint: 'No pause found: background noise may be louder than -38 dB, or the recording has no 2 s pauses between scenes'}
        : {}),
    };
  }

  const voiceDir = path.join(projectDir, 'voice');
  const ext = path.extname(file).toLowerCase() || '.audio';
  const recFinal = path.join(voiceDir, `recording${ext}`);
  const recTmp = path.join(voiceDir, `recording.tmp${ext}`);
  const copyRecording = path.resolve(file) !== path.resolve(recFinal);
  const staged: {tmp: string; final: string}[] = [];
  const seconds: number[] = [];

  await fs.mkdir(voiceDir, {recursive: true});
  // Leftovers of an earlier crash.
  for (const f of await fs.readdir(voiceDir)) {
    if (/\.tmp\.wav$/.test(f) || /^recording\.tmp\./.test(f) || /\.bak$/.test(f)) await rmQuiet(path.join(voiceDir, f));
  }
  const cleanTmp = () => Promise.all([...staged.map((s) => rmQuiet(s.tmp)), rmQuiet(recTmp)]);
  try {
    for (let i = 0; i < n; i++) {
      signal?.throwIfAborted();
      const id = p.scenes[i]!.id;
      const tmp = path.join(voiceDir, `${id}.tmp.wav`);
      staged.push({tmp, final: path.join(voiceDir, `${id}.wav`)});
      await cutAudio(file, segments[i]![0], segments[i]![1], tmp, signal);
      seconds.push(await probeAudioSeconds(tmp, signal));
    }
    signal?.throwIfAborted();
    if (copyRecording) await fs.copyFile(file, recTmp);
    signal?.throwIfAborted();
  } catch (e) {
    await cleanTmp();
    throw e;
  }

  // Swap in: current files -> .bak, new files in, restore everything on any failure.
  const targets = staged.map((s) => s.final);
  if (copyRecording) {
    targets.push(recFinal);
    for (const f of await fs.readdir(voiceDir)) {
      if (/^recording\.[^.]+$/.test(f) && path.join(voiceDir, f) !== recFinal) targets.push(path.join(voiceDir, f));
    }
  }
  const baked: string[] = [];
  const placed: string[] = [];
  const rollback = async () => {
    for (const f of placed) await rmQuiet(f);
    for (const f of baked) {
      try {
        await fs.rename(`${f}.bak`, f);
      } catch {
        // nothing more can be done
      }
    }
    await cleanTmp();
  };
  const project: Project = {
    ...p,
    voice: {...p.voice, engine: 'upload'},
    scenes: p.scenes.map((s, i) => {
      const {dirty: _dirty, ...rest} = s;
      return {
        ...rest,
        audio: {path: `voice/${s.id}.wav`, seconds: seconds[i]!, hash: 'upload'},
        durationFrames: durationFromAudio(seconds[i]!),
        warnings: s.warnings.filter((w) => !w.startsWith(VOICE_FAILED) && w !== NO_RECORDING_WARNING && w !== STALE_RECORDING_WARNING),
      };
    }),
    progress: {...p.progress, done: p.progress.done.filter((d) => !DROP.includes(d))},
  };
  try {
    for (const t of targets) {
      if (await exists(t)) {
        await fs.rename(t, `${t}.bak`);
        baked.push(t);
      }
    }
    for (const s of staged) {
      await fs.rename(s.tmp, s.final);
      placed.push(s.final);
    }
    if (copyRecording) {
      await fs.rename(recTmp, recFinal);
      placed.push(recFinal);
    }
    invalidateBundle(projectDir);
    await saveProject(projectDir, project);
  } catch (e) {
    await rollback();
    invalidateBundle(projectDir);
    throw e;
  }
  // The project is applied: what follows is housekeeping and must never fail the call.
  await Promise.all([
    ...baked.map((f) => rmQuiet(`${f}.bak`)),
    ...p.scenes.map((s) => rmQuiet(path.join(voiceDir, `${s.id}.mp3`))),
  ]);
  return {ok: true, project};
}
