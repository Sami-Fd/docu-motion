import {runRemotionTool} from './ffmpeg.js';

export type Silence = {start: number; end: number};

const EDGE = 0.05;

function parseDuration(stderr: string): number {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) throw new Error('Could not read the audio duration from ffmpeg output');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
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
  const duration = parseDuration(stderr);
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const silences: Silence[] = [];
  starts.forEach((start, i) => {
    // A trailing silence has no silence_end line: it runs to the end of the file.
    const end = ends[i] ?? duration;
    if (start < EDGE || end > duration - EDGE) return;
    silences.push({start, end});
  });
  return {silences, duration};
}

/** Midpoints of the silences, only when there are exactly `count - 1` of them. */
export function cutsFromSilences(silences: Silence[], count: number): number[] | undefined {
  if (silences.length !== count - 1) return undefined;
  return silences.map((s) => (s.start + s.end) / 2);
}
