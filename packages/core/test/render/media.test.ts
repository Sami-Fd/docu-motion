import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runRemotionTool, probeAudioSeconds, cutAudio} from '../../src/media/ffmpeg.js';
import {detectSilences, cutsFromSilences, parseSilences} from '../../src/media/silence.js';

let dir: string;
let rec: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'données é-'));
  rec = path.join(dir, 'rec.wav');
  const tone = (d: number) => ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${d}`];
  const quiet = (d: number) => ['-f', 'lavfi', '-t', String(d), '-i', 'anullsrc=r=44100:cl=mono'];
  await runRemotionTool('ffmpeg', [
    '-y',
    ...tone(2),
    ...quiet(2),
    ...tone(3),
    ...quiet(2),
    ...tone(2),
    '-filter_complex',
    '[0:a]aresample=44100,aformat=channel_layouts=mono[a0];[1:a]aresample=44100,aformat=channel_layouts=mono[a1];[2:a]aresample=44100,aformat=channel_layouts=mono[a2];[3:a]aresample=44100,aformat=channel_layouts=mono[a3];[4:a]aresample=44100,aformat=channel_layouts=mono[a4];[a0][a1][a2][a3][a4]concat=n=5:v=0:a=1[out]',
    '-map',
    '[out]',
    rec,
  ]);
}, 60_000);

afterAll(async () => {
  await fs.rm(dir, {recursive: true, force: true});
});

describe('media helpers', () => {
  it('probes audio duration without a video stream', async () => {
    expect(await probeAudioSeconds(rec)).toBeCloseTo(11, 1);
  });

  it('detects the two silences', async () => {
    const {silences, duration} = await detectSilences(rec);
    expect(duration).toBeCloseTo(11, 1);
    expect(silences).toHaveLength(2);
    expect(silences[0]!.start).toBeCloseTo(2, 0);
    expect(silences[0]!.end).toBeCloseTo(4, 0);
    expect(silences[1]!.start).toBeCloseTo(7, 0);
    expect(silences[1]!.end).toBeCloseTo(9, 0);
  });

  it('computes cuts only when the count matches', async () => {
    const {silences} = await detectSilences(rec);
    const cuts = cutsFromSilences(silences, 3)!;
    expect(cuts[0]).toBeCloseTo(3, 0);
    expect(cuts[1]).toBeCloseTo(8, 0);
    expect(cutsFromSilences(silences, 4)).toBeUndefined();
  });

  it('cuts a segment to a PCM wav', async () => {
    const out = path.join(dir, 'cut.wav');
    await cutAudio(rec, 0, 3, out);
    expect(await probeAudioSeconds(out)).toBeCloseTo(3, 1);
    const mid = path.join(dir, 'mid.wav');
    await cutAudio(rec, 4, 7, mid);
    expect(await probeAudioSeconds(mid)).toBeCloseTo(3, 1);
  }, 30_000);

  it('parses exponent notation and drops edge silences', () => {
    const err = ['silence_start: 2.3e-05', 'silence_end: 1.5', 'silence_start: 3', 'silence_end: 5.5e0'].join(String.fromCharCode(10));
    expect(parseSilences(err, 10)).toEqual([{start: 3, end: 5.5}]);
  });

  it('rejects with the stderr tail on failure', async () => {
    await expect(runRemotionTool('ffprobe', ['-v', 'error', path.join(dir, 'missing.wav')])).rejects.toThrow(/missing/);
  });
});
