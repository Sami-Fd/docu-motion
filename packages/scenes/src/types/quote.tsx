import React from 'react';
import {useCurrentFrame} from 'remotion';
import {Background, Canvas, Label, Pop, Text, clampInterp} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {useTheme} from '../theme';
import {Card, Source, fitSize, useCharWidth, wrapText} from './common';

const CARD_W = 1500;
const CARD_H = 520;
const CY = 570;
const TEXT_W = 1240;
const TEXT_H = 300;

/** Largest size (<= 60) at which the quote, word-wrapped, fits in TEXT_W x TEXT_H. */
const layoutQuote = (text: string, cw: number): {size: number; lines: string[]} => {
  for (let size = 60; size > 24; size -= 2) {
    const lines = wrapText(text, Math.floor(TEXT_W / (size * cw)));
    const longest = Math.max(...lines.map((l) => l.length));
    if (lines.length * size * 1.3 <= TEXT_H && longest * size * cw <= TEXT_W) return {size, lines};
  }
  return {size: 24, lines: wrapText(text, Math.floor(TEXT_W / (24 * cw)))};
};

// Opening quotation mark drawn as shapes (two comma-like marks), so it is language-neutral.
const QuoteMark: React.FC<{x: number; y: number; color: string}> = ({x, y, color}) => (
  <g transform={`translate(${x} ${y})`} fill={color}>
    {[0, 62].map((dx) => (
      <g key={dx} transform={`translate(${dx} 0)`}>
        <circle cx={0} cy={22} r={24} />
        <path d="M -24 22 C -24 -14, -4 -34, 22 -40 L 24 -30 C 6 -22, -4 -6, -2 10 Z" />
      </g>
    ))}
  </g>
);

// A large card with the quote and its author line underneath.
export const QuoteScene: React.FC<SceneProps<SceneOf<'quote'>>> = ({spec, narration, durationFrames}) => {
  const f = useCurrentFrame();
  const {colors} = useTheme();
  const cw = useCharWidth();
  const t0 = cueFrame(narration, undefined, durationFrames, 0);
  const {size, lines} = layoutQuote(spec.text, cw);
  const lineH = size * 1.3;
  const firstY = CY - 40 - ((lines.length - 1) * lineH) / 2 + size * 0.35;
  const author = `— ${spec.author}`;
  return (
    <Canvas>
      <Background />
      <Pop cx={960} cy={CY} delay={t0}>
        <Card x={960} y={CY} w={CARD_W} h={CARD_H} rot={-1} />
        <QuoteMark x={300} y={350} color={colors.accent} />
      </Pop>
      {lines.map((l, i) => (
        <Text key={i} x={960} y={firstY + i * lineH} size={size} bold
          opacity={clampInterp(f, [t0 + 10 + i * 6, t0 + 22 + i * 6], [0, 1])}>{l}</Text>
      ))}
      <Text x={1640} y={CY + CARD_H / 2 - 60} size={fitSize(author, 900, 40, cw)} anchor="end" opacity={0.8 * clampInterp(f, [t0 + 30, t0 + 42], [0, 1])}>
        {author}
      </Text>
      <Source>{spec.source}</Source>
      <Label title={spec.title} />
    </Canvas>
  );
};
