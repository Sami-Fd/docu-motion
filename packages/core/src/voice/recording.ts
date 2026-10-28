import {promises as fs} from 'node:fs';
import path from 'node:path';
import {durationFromAudio} from '@docu-motion/scenes';
import {STALE_RECORDING_WARNING, NO_RECORDING_WARNING, VOICE_FAILED} from '../generate/steps/voice.js';
import {cutAudio, probeAudioSeconds, runRemotionTool} from '../media/ffmpeg.js';
import {cutsFromSilences, detectSilences, type Silence} from '../media/silence.js';
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
  | {ok: false; found: number; needed: number; silences: Silence[]};

async function assertHasAudio(file: string): Promise<void> {
  let out: string;
  try {
    out = (await runRemotionTool('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file])).stdout;
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

/**
 * Splits a recording into one wav per scene and switches the project to the `upload` voice.
 *
 * All-or-nothing: every cut goes to a temp file and the recording is copied to a temp file first; only
 * when all of that succeeded are the files renamed into place and project.json saved. Any failure or
 * abort before the renames leaves the project and the previous audio untouched (temp files are removed).
 * The renames and the save are a short, non-transactional tail.
 */
export async function applyRecording(
  projectDir: string,
  file: string,
  opts: {cuts?: number[]; signal?: AbortSignal} = {},
): Promise<ApplyRecordingResult> {
  const {signal} = opts;
  signal?.throwIfAborted();
  const p = await loadProject(projectDir);
  const n = p.scenes.length;
  if (n === 0) throw new Error('The project has no scenes to split a recording into');
  await assertHasAudio(file);
  signal?.throwIfAborted();

  const {silences, duration} = await detectSilences(file);
  let cuts: number[] | undefined;
  if (opts.cuts) {
    checkCuts(opts.cuts, n - 1, duration);
    cuts = opts.cuts;
  } else {
    cuts = cutsFromSilences(silences, n);
    if (!cuts) return {ok: false, found: silences.length, needed: n - 1, silences};
  }

  const voiceDir = path.join(projectDir, 'voice');
  const ext = path.extname(file).toLowerCase() || '.audio';
  const recFinal = path.join(voiceDir, `recording${ext}`);
  const recTmp = path.join(voiceDir, `recording.tmp${ext}`);
  const bounds = [0, ...cuts, duration];
  const staged: {tmp: string; final: string}[] = [];
  const seconds: number[] = [];

  await fs.mkdir(voiceDir, {recursive: true});
  try {
    for (let i = 0; i < n; i++) {
      signal?.throwIfAborted();
      const id = p.scenes[i]!.id;
      const tmp = path.join(voiceDir, `${id}.tmp.wav`);
      staged.push({tmp, final: path.join(voiceDir, `${id}.wav`)});
      await cutAudio(file, bounds[i]!, bounds[i + 1]!, tmp);
      seconds.push(await probeAudioSeconds(tmp));
    }
    signal?.throwIfAborted();
    if (path.resolve(file) !== path.resolve(recFinal)) await fs.copyFile(file, recTmp);
    signal?.throwIfAborted();
  } catch (e) {
    await Promise.all([...staged.map((s) => fs.rm(s.tmp, {force: true})), fs.rm(recTmp, {force: true})]);
    throw e;
  }

  try {
    for (const s of staged) await fs.rename(s.tmp, s.final);
    if (path.resolve(file) !== path.resolve(recFinal)) {
      // Another extension from an earlier recording would be an orphan.
      for (const f of await fs.readdir(voiceDir)) {
        if (/^recording\.[^.]+$/.test(f) && path.join(voiceDir, f) !== recFinal) await fs.rm(path.join(voiceDir, f), {force: true});
      }
      await fs.rename(recTmp, recFinal);
    }
  } catch (e) {
    await Promise.all([...staged.map((s) => fs.rm(s.tmp, {force: true})), fs.rm(recTmp, {force: true})]);
    throw e;
  }

  const drop: StepName[] = ['voice', 'render', 'package'];
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
    progress: {...p.progress, done: p.progress.done.filter((d) => !drop.includes(d))},
  };
  await saveProject(projectDir, project);
  // Old TTS files are unreferenced now (the bundle only stages scene.audio paths); remove them as housekeeping.
  await Promise.all(p.scenes.map((s) => fs.rm(path.join(voiceDir, `${s.id}.mp3`), {force: true})));
  invalidateBundle(projectDir);
  return {ok: true, project};
}
