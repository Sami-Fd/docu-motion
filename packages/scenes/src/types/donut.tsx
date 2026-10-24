import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Background, Canvas, Label, Slide, Text, arc, clampInterp} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {SERIES_COLORS, Source, fitSize, formatPercent, useCharWidth} from './common';

const CX = 560;
const CY = 560;
const ROW_H = 90;
const LEGEND_X = 930;
const VALUE_X = 1760;
const VALUE_W = 170;

// The skill's `Financement`: each part sweeps in from its cue frame, its legend row slides in with it.
export const DonutScene: React.FC<SceneProps<SceneOf<'donut'>>> = ({spec, narration, durationFrames, language}) => {
  const f = useCurrentFrame();
  const cw = useCharWidth();
  const total = spec.parts.reduce((a, p) => a + p.value, 0);
  const top = CY - (spec.parts.length * ROW_H) / 2;
  const labelSize = Math.min(...spec.parts.map((p) => fitSize(p.label, VALUE_X - VALUE_W - (LEGEND_X + 75), 42, cw)));
  const colorOf = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length]!;
  let cumul = 0;
  return (
    <Canvas>
      <Background />
      <g filter="url(#papier)">
        {spec.parts.map((p, i) => {
          const start = (cumul / total) * 2 * Math.PI;
          cumul += p.value;
          const t0 = cueFrame(narration, p.cue, durationFrames, i);
          const end = start + clampInterp(f, [t0, t0 + 20], [0, 1]) * (p.value / total) * 2 * Math.PI;
          return end > start + 0.001 ? <path key={i} d={arc(CX, CY, 270, 135, start, end)} fill={colorOf(i)} /> : null;
        })}
      </g>
      {spec.parts.map((p, i) => {
        const t0 = cueFrame(narration, p.cue, durationFrames, i);
        const y = top + i * ROW_H;
        return (
          <Slide key={i} dx={300} delay={t0}>
            <g opacity={clampInterp(f, [t0, t0 + 8], [0, 1])}>
              <rect x={LEGEND_X} y={y + 20} width={50} height={50} rx={10} fill={colorOf(i)} />
              <Text x={LEGEND_X + 75} y={y + 60} size={labelSize} anchor="start" onBackground>{p.label}</Text>
              <Text x={VALUE_X} y={y + 60} size={42} bold anchor="end" onBackground>{formatPercent(p.value, language)}</Text>
            </g>
          </Slide>
        );
      })}
      <Source>{spec.source}</Source>
      <Label title={spec.title} />
    </Canvas>
  );
};
