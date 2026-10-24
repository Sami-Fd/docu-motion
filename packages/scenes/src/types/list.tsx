import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Background, Canvas, Character, Cloud, Coin, Drop, Label, Slide, Sun, Text, clampInterp} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {useTheme} from '../theme';
import {Card, PEOPLE_COLORS, Source, fitSize, useCharWidth} from './common';

type Icon = SceneOf<'list'>['items'][number]['icon'];

const TOP = 300;
// Five 96 px cards end at y = 852 (300 + 5*96 + 4*18); three or fewer get roomier 120 px cards.
const cardHeight = (n: number) => (n <= 3 ? 120 : 96);
const GAP = 18;
const CARD_W = 1360;
const CARD_X = 960;
const ICON_X = CARD_X - CARD_W / 2 + 70;
const TEXT_X = ICON_X + 70;

const ItemIcon: React.FC<{icon: Icon; x: number; y: number; i: number}> = ({icon, x, y, i}) => {
  const {colors} = useTheme();
  switch (icon) {
    case 'coin':
      return <Coin x={x} y={y} size={1.5} />;
    case 'drop':
      return <Drop x={x} y={y - 4} size={0.85} />;
    case 'sun':
      return <g transform={`translate(${x} ${y}) scale(0.3)`}><Sun x={0} y={0} r={70} /></g>;
    case 'cloud':
      return <g transform={`translate(${x} ${y - 6}) scale(0.32)`}><Cloud x={0} y={0} color={colors.nuageGris} /></g>;
    case 'character':
      return <Character x={x} y={y + 36} size={0.45} color={PEOPLE_COLORS[i % PEOPLE_COLORS.length]!} phase={i} />;
    case 'none':
      return <circle cx={x} cy={y} r={12} fill={colors.accent} />;
  }
};

// Paper cards stacked from y = 300, each sliding in on its cue, an icon on the left of the text.
export const ListScene: React.FC<SceneProps<SceneOf<'list'>>> = ({spec, narration, durationFrames}) => {
  const f = useCurrentFrame();
  const cw = useCharWidth();
  const maxTextW = CARD_X + CARD_W / 2 - 50 - TEXT_X;
  const cardH = cardHeight(spec.items.length);
  const size = Math.min(...spec.items.map((it) => fitSize(it.text, maxTextW, cardH > 100 ? 52 : 46, cw)));
  return (
    <Canvas>
      <Background />
      {spec.items.map((it, i) => {
        const t0 = cueFrame(narration, it.cue, durationFrames, i);
        const cy = TOP + cardH / 2 + i * (cardH + GAP);
        return (
          <Slide key={i} dx={-400} delay={t0}>
            <g opacity={clampInterp(f, [t0, t0 + 8], [0, 1])}>
              <Card x={CARD_X} y={cy} w={CARD_W} h={cardH} rot={i % 2 === 0 ? -0.6 : 0.6} />
              <ItemIcon icon={it.icon} x={ICON_X} y={cy} i={i} />
              <Text x={TEXT_X} y={cy + size * 0.35} size={size} anchor="start">{it.text}</Text>
            </g>
          </Slide>
        );
      })}
      <Source>{spec.source}</Source>
      <Label title={spec.title} />
    </Canvas>
  );
};
