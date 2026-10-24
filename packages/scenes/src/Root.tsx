import React from 'react';
import {AbsoluteFill, CalculateMetadataFunction, Composition} from 'remotion';
import {DEFAULT_LANGUAGE, Film, FPS, calculateFilmMetadata} from './film/Film';
import type {FilmInput} from './film/types';
import {SceneView} from './film/SceneView';
import {ThemeProvider, getTheme, type StyleName} from './theme';
import {Background, Canvas} from './kit';
import {EXAMPLES, SCENE_TYPES} from './schema';
import {clampFrames} from './film/pure';
import {estimateDurationFrames} from './timing';

export type SceneStillInput = FilmInput & {sceneIndex: number};

// Sample narration for Studio / `remotion compositions`; real projects pass their own props.
const SAMPLE_NARRATION = 'Une phrase pour tester le rendu. Une seconde phrase, un peu plus longue, pour les sous-titres.';

const defaultFilm: FilmInput = {
  style: 'papier',
  language: DEFAULT_LANGUAGE,
  subtitles: true,
  assetBase: null,
  scenes: SCENE_TYPES.map((t) => ({
    id: t,
    narration: SAMPLE_NARRATION,
    spec: EXAMPLES[t],
    durationFrames: estimateDurationFrames(SAMPLE_NARRATION),
  })),
};

const stillScene = ({scenes, sceneIndex}: {scenes: FilmInput['scenes']; sceneIndex: number}) => {
  const s = scenes[sceneIndex];
  if (!s) throw new Error(`SceneStill: sceneIndex ${sceneIndex} is out of range (${scenes.length} scenes)`);
  return s;
};

const SceneStill: React.FC<SceneStillInput> = ({style, language, scenes, sceneIndex}) => {
  const s = stillScene({scenes, sceneIndex});
  return (
    <ThemeProvider style={style}>
      <AbsoluteFill style={{backgroundColor: getTheme(style).colors.creme}}>
        <SceneView spec={s.spec} narration={s.narration} durationFrames={s.durationFrames} index={sceneIndex}
          language={language ?? DEFAULT_LANGUAGE} />
      </AbsoluteFill>
    </ThemeProvider>
  );
};

export const calculateStillMetadata: CalculateMetadataFunction<SceneStillInput> = async ({props}) => ({
  durationInFrames: clampFrames(stillScene(props).durationFrames),
});

// The bare scene background of a style: reference image for the "layout stays inside frame" test.
const BackgroundStill: React.FC<{style: StyleName}> = ({style}) => (
  <ThemeProvider style={style}>
    <AbsoluteFill style={{backgroundColor: getTheme(style).colors.creme}}>
      <Canvas>
        <Background />
      </Canvas>
    </AbsoluteFill>
  </ThemeProvider>
);

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
    <Composition
      id="BackgroundStill"
      component={BackgroundStill}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={1}
      defaultProps={{style: 'papier' as StyleName}}
    />
  </>
);
