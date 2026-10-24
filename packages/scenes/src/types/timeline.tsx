import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Background, Canvas, Label, Pop, Slide, Text, clampInterp} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {useTheme} from '../theme';
import {SERIES_COLORS, Source, fitSize, twoLines, useCharWidth} from './common';

const LINE_Y = 560;
const LEFT = 160;
const RIGHT = 1760;

// Dots on a horizontal line at y = 560: date above, label (up to two lines) below, each on its cue.
// The line draws itself from the first event to the last.
export const TimelineScene: React.FC<SceneProps<SceneOf<'timeline'>>> = ({spec, narration, durationFrames}) => {
  const f = useCurrentFrame();
  const {colors, textScale} = useTheme();
  const cw = useCharWidth();
  const n = spec.events.length;
  const slot = (RIGHT - LEFT) / n;
  const xs = spec.events.map((_, i) => LEFT + slot * (i + 0.5));
  const cues = spec.events.map((e, i) => cueFrame(narration, e.cue, durationFrames, i));
  // At most two lines per label; the shared font size shrinks to fit the longest line.
  const lines = spec.events.map((e) => (fitSize(e.label, slot - 24, 36, cw) >= 30 ? [e.label] : twoLines(e.label)));
  const labelSize = Math.min(...lines.flat().map((l) => fitSize(l, slot - 24, 36, cw)));
  const dateSize = Math.min(...spec.events.map((e) => fitSize(e.date, slot - 24, 56, cw * 1.05)));
  const first = Math.min(...cues);
  const last = Math.max(...cues);
  const reach = clampInterp(f, [first, Math.max(first + 20, last + 10)], [0, 1]);
  const x0 = xs[0]! - slot * 0.4;
  const x1 = xs[n - 1]! + slot * 0.4;
  return (
    <Canvas>
      <Background />
      <g filter="url(#papier)">
        <rect x={x0} y={LINE_Y - 5} width={Math.max(0, (x1 - x0) * reach)} height={10} rx={5} fill={colors.texteFond} opacity={0.7} />
      </g>
      {spec.events.map((e, i) => {
        const t0 = cues[i]!;
        const x = xs[i]!;
        const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
        return (
          <g key={i}>
            <Pop cx={x} cy={LINE_Y} delay={t0}>
              <circle cx={x} cy={LINE_Y} r={26} fill={color} />
              <circle cx={x} cy={LINE_Y} r={10} fill={colors.etiquette} />
            </Pop>
            <Slide dy={-30} delay={t0}>
              <g opacity={clampInterp(f, [t0, t0 + 8], [0, 1])}>
                <Text x={x} y={LINE_Y - 60} size={dateSize} bold onBackground>{e.date}</Text>
              </g>
            </Slide>
            <Slide dy={30} delay={t0 + 4}>
              <g opacity={clampInterp(f, [t0 + 4, t0 + 12], [0, 1])}>
                {lines[i]!.map((l, k) => (
                  <Text key={k} x={x} y={LINE_Y + 85 + k * labelSize * textScale * 1.2} size={labelSize} onBackground>{l}</Text>
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
