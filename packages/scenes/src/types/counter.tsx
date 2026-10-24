import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Background, Canvas, Label, Pop, Text, clampInterp} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {BLUE, Card, Source, decimalsOf, fitSize, formatNumber, useCharWidth} from './common';

const CARD_W = 1400;

// A big number counting from 0 to its value over 30 frames from the cue, on a paper card.
export const CounterScene: React.FC<SceneProps<SceneOf<'counter'>>> = ({spec, narration, durationFrames, language}) => {
  const f = useCurrentFrame();
  const cw = useCharWidth();
  const t0 = cueFrame(narration, spec.cue, durationFrames, 0);
  const current = clampInterp(f, [t0, t0 + 30], [0, spec.value]);
  const decimals = decimalsOf(spec.value);
  const text = (n: number) => `${spec.prefix ?? ''}${formatNumber(n, language, decimals)}${spec.suffix ? ` ${spec.suffix}` : ''}`;
  // Sized from the final value so the number keeps its size while counting (bold digits are wider).
  const numberSize = fitSize(text(spec.value), CARD_W - 140, 190, cw * 1.3);
  const labelSize = fitSize(spec.label, CARD_W - 140, 52, cw);
  return (
    <Canvas>
      <Background />
      <Pop cx={960} cy={570} delay={t0}>
        <Card x={960} y={570} w={CARD_W} h={440} rot={-1} />
        <Text x={960} y={590} size={numberSize} bold color={BLUE}>{text(current)}</Text>
        <Text x={960} y={700} size={labelSize}>{spec.label}</Text>
      </Pop>
      <Source>{spec.source}</Source>
      <Label title={spec.title} />
    </Canvas>
  );
};
