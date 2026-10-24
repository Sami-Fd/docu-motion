import React from 'react';
import {Background, Canvas, Label, Pop, Text} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {BLUE, Card, RED, Source, fitSize, useCharWidth} from './common';

type Side = SceneOf<'comparison'>['left'];

const CARD_W = 780;

// Big values use a wide glyph estimate (bold, possibly capitals) so they never leave their card.
const SideCard: React.FC<{x: number; side: Side; color: string; rot: number; delay: number}> = ({x, side, color, rot, delay}) => {
  const cw = useCharWidth();
  return (
    <Pop cx={x} cy={560} delay={delay}>
      <Card x={x} y={560} w={CARD_W} h={540} rot={rot} />
      <Text x={x} y={380} size={fitSize(side.heading, CARD_W - 100, 52, cw)} bold>{side.heading}</Text>
      <rect x={x - 60} y={410} width={120} height={8} rx={4} fill={color} opacity={0.8} />
      <Text x={x} y={620} size={fitSize(side.value, CARD_W - 100, 170, cw * 1.7)} bold color={color}>{side.value}</Text>
      {side.caption && <Text x={x} y={730} size={fitSize(side.caption, CARD_W - 100, 40, cw)}>{side.caption}</Text>}
    </Pop>
  );
};

// Two cards side by side at x = 540 / 1380, each popping in on its cue.
export const ComparisonScene: React.FC<SceneProps<SceneOf<'comparison'>>> = ({spec, narration, durationFrames}) => (
  <Canvas>
    <Background />
    <SideCard x={540} side={spec.left} color={BLUE} rot={-1.5} delay={cueFrame(narration, spec.left.cue, durationFrames, 0)} />
    <SideCard x={1380} side={spec.right} color={RED} rot={1.5} delay={cueFrame(narration, spec.right.cue, durationFrames, 1)} />
    <Source>{spec.source}</Source>
    <Label title={spec.title} />
  </Canvas>
);
