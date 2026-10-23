import {describe, expect, it} from 'vitest';
import {calculateFilmMetadata, type FilmInput} from '../src/film/Film';
import {SCENE_COMPONENTS} from '../src/film/SceneView';
import {SCENE_TYPES, EXAMPLES} from '../src/schema';

const film = (durations: number[]): FilmInput => ({
  style: 'papier',
  subtitles: true,
  assetBase: null,
  scenes: durations.map((d, i) => ({id: `s${i}`, narration: 'x', spec: EXAMPLES.title, durationFrames: d})),
});

const meta = (input: FilmInput) =>
  calculateFilmMetadata({props: input, defaultProps: input, abortSignal: new AbortController().signal, compositionId: 'Film', isRendering: false});

describe('film', () => {
  it('sums scene durations', async () => {
    expect(await meta(film([90, 120]))).toMatchObject({durationInFrames: 210});
  });
  it('is at least 1 frame for empty scenes', async () => {
    expect(await meta(film([]))).toMatchObject({durationInFrames: 1});
  });
  it('has a component for every scene type', () => {
    for (const t of SCENE_TYPES) expect(SCENE_COMPONENTS[t]).toBeTypeOf('function');
  });
});
