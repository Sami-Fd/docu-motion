import {describe, expect, it} from 'vitest';
import {staticFile} from 'remotion';
import {audioUrl, calculateFilmMetadata, type FilmInput} from '../src/film/Film';
import {SCENE_COMPONENTS} from '../src/film/SceneView';
import {fadeOpacity, subtitleAt} from '../src/film/pure';
import {calculateStillMetadata, type SceneStillInput} from '../src/Root';
import {SCENE_TYPES, EXAMPLES} from '../src/schema';

const film = (durations: number[]): FilmInput => ({
  style: 'papier',
  language: 'fr',
  subtitles: true,
  assetBase: null,
  scenes: durations.map((d, i) => ({id: `s${i}`, narration: 'x', spec: EXAMPLES.title, durationFrames: d})),
});

const opts = (input: unknown) =>
  ({props: input, defaultProps: input, abortSignal: new AbortController().signal, compositionId: 'x', isRendering: false}) as never;
const meta = (input: FilmInput) => calculateFilmMetadata(opts(input));

describe('film', () => {
  it('sums scene durations', async () => {
    expect(await meta(film([90, 120]))).toMatchObject({durationInFrames: 210});
  });
  it('is at least 1 frame for empty scenes', async () => {
    expect(await meta(film([]))).toMatchObject({durationInFrames: 1});
  });
  it('clamps zero-length scenes like Series does', async () => {
    expect(await meta(film([0, 5]))).toMatchObject({durationInFrames: 6});
  });
  it('has a component for every scene type', () => {
    for (const t of SCENE_TYPES) expect(SCENE_COMPONENTS[t]).toBeTypeOf('function');
  });
});

describe('audioUrl', () => {
  it('uses staticFile when assetBase is null', () => {
    expect(audioUrl(null, 'voix/a.mp3')).toBe(staticFile('voix/a.mp3'));
  });
  it('joins assetBase and path otherwise', () => {
    expect(audioUrl('http://localhost:3000/assets', 'voix/a.mp3')).toBe('http://localhost:3000/assets/voix/a.mp3');
  });
});

describe('fadeOpacity', () => {
  it.each([1, 2, 15, 19, 20, 300])('never throws and stays within 0..1 for d=%i', (d) => {
    for (let f = 0; f <= d; f++) {
      const o = fadeOpacity(f, d);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
  it('ramps 0 to 1 to 0 on a long scene', () => {
    expect(fadeOpacity(0, 300)).toBe(0);
    expect(fadeOpacity(5, 300)).toBeCloseTo(0.5);
    expect(fadeOpacity(150, 300)).toBe(1);
    expect(fadeOpacity(295, 300)).toBeCloseTo(0.5);
    expect(fadeOpacity(300, 300)).toBe(0);
  });
  it('shrinks the ramp on a 15-frame scene and is opaque for d=1', () => {
    expect(fadeOpacity(0, 15)).toBe(0);
    expect(fadeOpacity(7, 15)).toBe(1);
    expect(fadeOpacity(15, 15)).toBe(0);
    expect(fadeOpacity(0, 1)).toBe(1);
  });
});

describe('subtitleAt', () => {
  const text = 'Short one. A much longer second sentence follows here!';
  const second = 'A much longer second sentence follows here!';
  it('shows sentences in order, proportional to length', () => {
    expect(subtitleAt(text, 220, 5)).toBe('Short one.');
    expect(subtitleAt(text, 220, 100)).toBe(second);
    expect(subtitleAt(text, 220, 5000)).toBe(second);
    // first sentence is 10/53 of the 200 usable frames, so it ends near frame 5 + 37.7
    expect(subtitleAt(text, 220, 42)).toBe('Short one.');
    expect(subtitleAt(text, 220, 44)).toBe(second);
  });
  it('handles short scenes without NaN or negatives', () => {
    for (const d of [0, 1, 10, 20]) {
      expect(subtitleAt(text, d, 0)).toBe('Short one.');
      expect(subtitleAt(text, d, 3)).not.toBeNull();
    }
  });
  it('returns null for empty or whitespace text', () => {
    expect(subtitleAt('', 100, 10)).toBeNull();
    expect(subtitleAt('   ', 100, 10)).toBeNull();
  });
});

describe('SceneStill metadata', () => {
  const input = (i: number): SceneStillInput => ({...film([90, 0]), sceneIndex: i});
  const stillMeta = (i: number) => calculateStillMetadata(opts(input(i)));
  it('gives the chosen scene duration, at least 1', async () => {
    expect(await stillMeta(0)).toMatchObject({durationInFrames: 90});
    expect(await stillMeta(1)).toMatchObject({durationInFrames: 1});
  });
  it('throws a clear error for an out-of-range index', async () => {
    await expect(stillMeta(5)).rejects.toThrow(/sceneIndex 5.*2 scenes/);
  });
});
