import {describe, it, expect} from 'vitest';
import {parseDecodedSeconds, parseRawSilences, segmentsFromCuts, segmentsFromSilences} from '../../src/media/silence.js';

describe('silence parsing helpers', () => {
  it('reads the last decoded time when the header has no duration', () => {
    const err = 'Duration: N/A, start: 0.0\r size=N/A time=00:00:01.50 bitrate=N/A\rsize=N/A time=00:01:02.25 bitrate=N/A\n';
    expect(parseDecodedSeconds(err)).toBeCloseTo(62.25);
    expect(parseDecodedSeconds('nothing')).toBeUndefined();
  });

  it('keeps edge silences in the raw parse', () => {
    const err = ['silence_start: 0', 'silence_end: 3', 'silence_start: 5', 'silence_end: 7', 'silence_start: 12'].join('\n');
    expect(parseRawSilences(err, 14)).toEqual([
      {start: 0, end: 3},
      {start: 5, end: 7},
      {start: 12, end: 14},
    ]);
  });

  it('builds padded segments from silences, midpoint for short ones', () => {
    const segs = segmentsFromSilences([{start: 5, end: 7}, {start: 10, end: 10.4}], 3, 12, 14, 3);
    expect(segs).toEqual([[2.7, 5.3], [6.7, 10.2], [10.2, 12.3]]);
  });

  it('builds segments from exact cuts, trimming only the ends', () => {
    expect(segmentsFromCuts([5, 9], 3, 12, 14)).toEqual([[2.7, 5], [5, 9], [9, 12.3]]);
    expect(segmentsFromCuts([], 0, 14, 14)).toEqual([[0, 14]]);
  });
});
