import React from 'react';
import {AbsoluteFill, CalculateMetadataFunction, Html5Audio, Series, staticFile, useCurrentFrame} from 'remotion';
import {ThemeProvider, getTheme} from '../theme';
import {SceneView} from './SceneView';
import {Subtitles} from './Subtitles';
import {clampFrames, fadeOpacity} from './pure';
import type {FilmInput} from './types';

export type {FilmInput, FilmScene, SceneProps} from './types';

export const FPS = 30;

export const calculateFilmMetadata: CalculateMetadataFunction<FilmInput> = async ({props}) => ({
  durationInFrames: Math.max(1, props.scenes.reduce((a, s) => a + clampFrames(s.durationFrames), 0)),
});

export const audioUrl = (assetBase: string | null, audioPath: string): string =>
  assetBase === null ? staticFile(audioPath) : `${assetBase}/${audioPath}`;

const Fade: React.FC<{durationFrames: number; children: React.ReactNode}> = ({durationFrames, children}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{opacity: fadeOpacity(frame, durationFrames)}}>{children}</AbsoluteFill>;
};

export const Film: React.FC<FilmInput> = ({style, subtitles, assetBase, scenes}) => (
  <ThemeProvider style={style}>
    <AbsoluteFill style={{backgroundColor: getTheme(style).colors.creme}}>
      <Series>
        {scenes.map((s, i) => {
          const d = clampFrames(s.durationFrames);
          return (
            <Series.Sequence key={s.id} durationInFrames={d}>
              <Fade durationFrames={d}>
                <SceneView spec={s.spec} narration={s.narration} durationFrames={d} index={i} />
              </Fade>
              {subtitles && <Subtitles text={s.narration} durationFrames={d} />}
              {s.audioPath && <Html5Audio src={audioUrl(assetBase, s.audioPath)} />}
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  </ThemeProvider>
);
