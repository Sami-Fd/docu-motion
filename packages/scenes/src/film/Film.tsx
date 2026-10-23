import React from 'react';
import {AbsoluteFill, CalculateMetadataFunction, Html5Audio, interpolate, Series, staticFile, useCurrentFrame} from 'remotion';
import {ThemeProvider, getTheme} from '../theme';
import {SceneView} from './SceneView';
import {Subtitles} from './Subtitles';
import type {FilmInput} from './types';

export type {FilmInput, FilmScene, SceneProps} from './types';

export const FPS = 30;

export const calculateFilmMetadata: CalculateMetadataFunction<FilmInput> = async ({props}) => ({
  durationInFrames: Math.max(1, props.scenes.reduce((a, s) => a + s.durationFrames, 0)),
});

export const audioUrl = (assetBase: string | null, audioPath: string): string =>
  assetBase === null ? staticFile(audioPath) : `${assetBase}/${audioPath}`;

const Fade: React.FC<{durationFrames: number; children: React.ReactNode}> = ({durationFrames, children}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, durationFrames - 10, durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

export const Film: React.FC<FilmInput> = ({style, subtitles, assetBase, scenes}) => (
  <ThemeProvider style={style}>
    <AbsoluteFill style={{backgroundColor: getTheme(style).colors.creme}}>
      <Series>
        {scenes.map((s, i) => (
          <Series.Sequence key={s.id} durationInFrames={Math.max(1, s.durationFrames)}>
            <Fade durationFrames={s.durationFrames}>
              <SceneView spec={s.spec} narration={s.narration} durationFrames={s.durationFrames} index={i} />
            </Fade>
            {subtitles && <Subtitles text={s.narration} durationFrames={s.durationFrames} />}
            {s.audioPath && <Html5Audio src={audioUrl(assetBase, s.audioPath)} />}
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  </ThemeProvider>
);
