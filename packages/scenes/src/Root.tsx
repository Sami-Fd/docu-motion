import React from 'react';
import {AbsoluteFill, CalculateMetadataFunction, Composition} from 'remotion';
import {Film, FPS, calculateFilmMetadata} from './film/Film';
import type {FilmInput} from './film/types';
import {SceneView} from './film/SceneView';
import {ThemeProvider, getTheme} from './theme';
import {EXAMPLES, SCENE_TYPES} from './schema';
import {estimateDurationFrames} from './timing';

export type SceneStillInput = FilmInput & {sceneIndex: number};

// Sample narration for Studio / `remotion compositions`; real projects pass their own props.
const SAMPLE_NARRATION = 'Une phrase pour tester le rendu. Une seconde phrase, un peu plus longue, pour les sous-titres.';

const defaultFilm: FilmInput = {
  style: 'papier',
  subtitles: true,
  assetBase: null,
  scenes: SCENE_TYPES.map((t) => ({
    id: t,
    narration: SAMPLE_NARRATION,
    spec: EXAMPLES[t],
    durationFrames: estimateDurationFrames(SAMPLE_NARRATION),
  })),
};

const SceneStill: React.FC<SceneStillInput> = ({style, scenes, sceneIndex}) => {
  const s = scenes[sceneIndex];
  if (!s) return null;
  return (
    <ThemeProvider style={style}>
      <AbsoluteFill style={{backgroundColor: getTheme(style).colors.creme}}>
        <SceneView spec={s.spec} narration={s.narration} durationFrames={s.durationFrames} index={sceneIndex} />
      </AbsoluteFill>
    </ThemeProvider>
  );
};

const calculateStillMetadata: CalculateMetadataFunction<SceneStillInput> = async ({props}) => ({
  durationInFrames: Math.max(1, props.scenes[props.sceneIndex]?.durationFrames ?? 1),
});

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Film"
      component={Film}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={1}
      defaultProps={defaultFilm}
      calculateMetadata={calculateFilmMetadata}
    />
    <Composition
      id="SceneStill"
      component={SceneStill}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={1}
      defaultProps={{...defaultFilm, sceneIndex: 0}}
      calculateMetadata={calculateStillMetadata}
    />
  </>
);
