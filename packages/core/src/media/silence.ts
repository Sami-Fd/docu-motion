import {probeAudioSeconds, runRemotionTool} from './ffmpeg.js';

export type Silence = {start: number; end: number};

const EDGE = 0.05;

const NUM = String.raw`(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)`;

/** Duration from the ffmpeg header, or undefined when it is N/A or missing. */
function parseDuration(stderr: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
}

/** Decoded length from the last `time=` progress line, for files whose header has no duration (webm). */
export function parseDecodedSeconds(stderr: string): number | undefined {
  const all = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const m = all[all.length - 1];
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
}

/** Every silence, including the ones touching the start or the end of the file. */
export function parseRawSilences(stderr: string, duration: number): Silence[] {
  const starts = [...stderr.matchAll(new RegExp(String.raw`silence_start:\s*${NUM}`, 'gi'))].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(new RegExp(String.raw`silence_end:\s*${NUM}`, 'gi'))].map((m) => Number(m[1]));
  const silences: Silence[] = [];
  starts.forEach((start, i) => {
    // A trailing silence may have no silence_end line: it runs to the end of the file.
    const end = ends[i] ?? duration;
    silences.push({start, end});
  });
  return silences;
}

export function parseSilences(stderr: string, duration: number): Silence[] {
  return parseRawSilences(stderr, duration).filter((s) => !(s.start < EDGE || s.end > duration - EDGE));
}

/** Where the sound starts and ends once leading and trailing silence are set aside. */
export function soundBounds(stderr: string, duration: number): {soundStart: number; soundEnd: number} {
  const raw = parseRawSilences(stderr, duration);
  const first = raw[0];
  const last = raw[raw.length - 1];
  return {
    soundStart: first && first.start < EDGE ? first.end : 0,
    soundEnd: last && last.end > duration - EDGE ? last.start : duration,
  };
}

const PAD = 0.3;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Segment per scene from detected silences: a scene ends PAD after its silence starts and the next one
 * starts PAD before it ends (midpoint when the silence is shorter than 2 x PAD). The ends are trimmed to PAD
 * around the first and last sound.
 */
export function segmentsFromSilences(
  silences: Silence[],
  soundStart: number,
  soundEnd: number,
  duration: number,
  count: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const before = silences[i - 1];
    const after = silences[i];
    const start = before ? (before.end - before.start < 2 * PAD ? (before.start + before.end) / 2 : before.end - PAD) : Math.max(0, soundStart - PAD);
    const end = after ? (after.end - after.start < 2 * PAD ? (after.start + after.end) / 2 : after.start + PAD) : Math.min(duration, soundEnd + PAD);
    out.push([round3(start), round3(end)]);
  }
  return out;
}

/** Segments from explicit cut times: exact boundaries, only the file's lead-in and tail trimmed. */
export function segmentsFromCuts(cuts: number[], soundStart: number, soundEnd: number, duration: number): [number, number][] {
  const b = [Math.max(0, soundStart - PAD), ...cuts, Math.min(duration, soundEnd + PAD)];
  return b.slice(0, -1).map((x, i) => [round3(x), round3(b[i + 1]!)] as [number, number]);
}

export async function detectSilences(
  file: string,
  opts: {noiseDb?: number; minSeconds?: number; signal?: AbortSignal} = {},
): Promise<{silences: Silence[]; duration: number; soundStart: number; soundEnd: number}> {
  const noiseDb = opts.noiseDb ?? -38;
  const minSeconds = opts.minSeconds ?? 1.2;
  const {stderr} = await runRemotionTool('ffmpeg', [
    '-hide_banner',
    '-i',
    file,
    '-af',
    `silencedetect=n=${noiseDb}dB:d=${minSeconds}`,
    '-f',
    'null',
    '-',
  ], {signal: opts.signal});
  let duration = parseDuration(stderr);
  if (duration === undefined) {
    try {
      duration = await probeAudioSeconds(file, opts.signal);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      duration = parseDecodedSeconds(stderr);
      if (duration === undefined) throw e;
    }
  }
  return {silences: parseSilences(stderr, duration), duration, ...soundBounds(stderr, duration)};
}

/** Midpoints of the silences, only when there are exactly `count - 1` of them. */
export function cutsFromSilences(silences: Silence[], count: number): number[] | undefined {
  if (silences.length !== count - 1) return undefined;
  return silences.map((s) => (s.start + s.end) / 2);
}
