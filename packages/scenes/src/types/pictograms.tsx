import React from 'react';
import {Background, Canvas, Character, Label, Pop, Text} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {BLUE, Card, ELDERLY_COLOR, PEOPLE_COLORS, Source, fitSize, useCharWidth} from './common';

type Group = SceneOf<'pictograms'>['groups'][number];

const CARD_Y = 560;
const CARD_H = 560;

// The skill's `Panneau`: a paper card with a heading, rows of characters and an optional ratio.
const Panel: React.FC<{x: number; w: number; group: Group; delay: number}> = ({x, w, group, delay}) => {
  const cw = useCharWidth();
  const rows = group.count > 6 ? 2 : 1;
  const perRow = Math.ceil(group.count / rows);
  const gap = Math.min(110, (w - 120) / perRow);
  const size = rows === 1 ? 0.8 : 0.62;
  const hasRatio = group.ratio !== undefined;
  // Feet of each row; the block is centred in the space between heading and ratio.
  const rowYs = rows === 1 ? [hasRatio ? 630 : 680] : hasRatio ? [540, 680] : [580, 740];
  return (
    <Pop cx={x} cy={CARD_Y} delay={delay}>
      <Card x={x} y={CARD_Y} w={w} h={CARD_H} />
      <Text x={x} y={350} size={fitSize(group.label, w - 80, 48, cw)} bold>{group.label}</Text>
      {Array.from({length: group.count}).map((_, i) => {
        const row = Math.floor(i / perRow);
        const inRow = row === rows - 1 ? group.count - perRow * (rows - 1) : perRow;
        const k = i - row * perRow;
        return (
          <Character
            key={i}
            x={x - ((inRow - 1) * gap) / 2 + k * gap}
            y={rowYs[row]!}
            size={size}
            color={group.elderly ? ELDERLY_COLOR : PEOPLE_COLORS[i % PEOPLE_COLORS.length]!}
            elderly={group.elderly}
            phase={i}
          />
        );
      })}
      {hasRatio && <Text x={x} y={790} size={fitSize(group.ratio!, w - 80, 80, cw)} bold color={BLUE}>{group.ratio}</Text>}
    </Pop>
  );
};

export const PictogramsScene: React.FC<SceneProps<SceneOf<'pictograms'>>> = ({spec, narration, durationFrames}) => {
  const two = spec.groups.length === 2;
  return (
    <Canvas>
      <Background />
      {spec.groups.map((g, i) => (
        <Panel key={i} x={two ? (i === 0 ? 540 : 1380) : 960} w={two ? 780 : 900} group={g}
          delay={cueFrame(narration, g.cue, durationFrames, i)} />
      ))}
      <Source>{spec.source}</Source>
      <Label title={spec.title} />
    </Canvas>
  );
};
