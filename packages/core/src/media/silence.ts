import {probeAudioSeconds, runRemotionTool} from './ffmpeg.js';

export type Silence = {start: number; end: number};

const EDGE = 0.05;

const NUM = String.raw`(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)`;

/** Duration from the ffmpeg header, or undefined when it is N/A or missing. */
function parseDuration(stderr: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
}

export function parseSilences(stderr: string, duration: number): Silence[] {
  const starts = [...stderr.matchAll(new RegExp(String.raw`silence_start:\s*${NUM}`, 'gi'))].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(new RegExp(String.raw`silence_end:\s*${NUM}`, 'gi'))].map((m) => Number(m[1]));
  const silences: Silence[] = [];
  starts.forEach((start, i) => {
    // A trailing silence may have no silence_end line: it runs to the end of the file.
    const end = ends[i] ?? duration;
    if (start < EDGE || end > duration - EDGE) return;
    silences.push({start, end});
  });
  return silences;
}

export async function detectSilences(
  file: string,
  opts: {noiseDb?: number; minSeconds?: number} = {},
): Promise<{silences: Silence[]; duration: number}> {
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
  ]);
  const duration = parseDuration(stderr) ?? (await probeAudioSeconds(file));
  return {silences: parseSilences(stderr, duration), duration};
}

/** Midpoints of the silences, only when there are exactly `count - 1` of them. */
export function cutsFromSilences(silences: Silence[], count: number): number[] | undefined {
  if (silences.length !== count - 1) return undefined;
  return silences.map((s) => (s.start + s.end) / 2);
}
