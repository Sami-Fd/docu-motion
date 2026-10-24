import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Background, Canvas, Label, Slide, Text, clampInterp} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {useTheme} from '../theme';
import {SERIES_COLORS, Source, fitSize, formatNumber, useCharWidth, wrapText} from './common';

const LEFT = 220;
const RIGHT = 1700;
const BASE_Y = 750;
const MAX_H = 380;

// Vertical bar chart: each bar grows over 20 frames from its cue, value on top, label below.
export const BarsScene: React.FC<SceneProps<SceneOf<'bars'>>> = ({spec, narration, durationFrames, language}) => {
  const f = useCurrentFrame();
  const {colors} = useTheme();
  const cw = useCharWidth();
  const n = spec.bars.length;
  const slot = (RIGHT - LEFT) / n;
  const barW = Math.min(170, slot * 0.6);
  const max = Math.max(...spec.bars.map((b) => b.value), 1e-9);
  // One font size for all category labels, on at most two lines, so the row looks even.
  const labelLines = spec.bars.map((b) => wrapText(b.label, Math.max(6, Math.ceil(b.label.length / 2))));
  const singleLine = spec.bars.every((b) => fitSize(b.label, slot - 20, 36, cw) >= 30);
  const lines = singleLine ? spec.bars.map((b) => [b.label]) : labelLines;
  const labelSize = Math.min(...lines.map((ls) => Math.min(...ls.map((l) => fitSize(l, slot - 20, 36, cw)))));
  const values = spec.bars.map((b) => `${formatNumber(b.value, language)}${spec.unit ? ` ${spec.unit}` : ''}`);
  const valueSize = Math.min(...values.map((v) => fitSize(v, slot - 10, 40, cw)));
  return (
    <Canvas>
      <Background />
      <rect x={LEFT - 20} y={BASE_Y} width={RIGHT - LEFT + 40} height={6} rx={3} fill={colors.texteFond} opacity={0.6} />
      {spec.bars.map((b, i) => {
        const t0 = cueFrame(narration, b.cue, durationFrames, i);
        const p = clampInterp(f, [t0, t0 + 20], [0, 1]);
        const h = (b.value / max) * MAX_H * p;
        const cx = LEFT + slot * (i + 0.5);
        const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
        return (
          <g key={i}>
            <g filter="url(#papier)">
              {h > 0.5 && <rect x={cx - barW / 2} y={BASE_Y - h} width={barW} height={h} rx={Math.min(14, h / 2)} fill={color} />}
            </g>
            <Text x={cx} y={BASE_Y - h - 18} size={valueSize} bold onBackground opacity={clampInterp(f, [t0 + 10, t0 + 20], [0, 1])}>
              {values[i]}
            </Text>
            <Slide dy={40} delay={t0}>
              <g opacity={clampInterp(f, [t0, t0 + 8], [0, 1])}>
                {lines[i]!.map((l, k) => (
                  <Text key={k} x={cx} y={BASE_Y + 48 + k * labelSize * 1.1} size={labelSize} onBackground>{l}</Text>
                ))}
              </g>
            </Slide>
          </g>
        );
      })}
      <Source>{spec.source}</Source>
      <Label title={spec.title} />
    </Canvas>
  );
};
