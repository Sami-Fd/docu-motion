import React from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender} from 'remotion';
import {ThemeProvider, fontReady, getTheme, useTheme, type StyleName} from '../theme';
import {Background, Canvas, Character, Coin, Text} from '../kit';
import {PEOPLE_COLORS} from '../types/common';
import {BLOCK_HEIGHT, LINE_HEIGHT, fitWordSize, narrowFactor, upperCase, widthEm, type MeasureEm} from './fit';
import type {ThumbnailSpec} from './schema';

// Layout in the 1920x1080 canvas (the 1280x720 output is a 2/3 scale, so its 40 px inset is 60 here).
const TEXT_X = 110;
const TEXT_WIDTH = 1040; // the left 60 % of the frame, minus the margin
const CENTER_Y = 540;
const RIGHT_X = 1530;
const WORD_WEIGHT = 600;

// Width in em of the effective font size of `text` (to its rightmost ink), taken from a real SVG <text> in the DOM: the same
// element type, font family and weight the thumbnail draws with, so what is measured is what is rendered.
const measureRendered = (text: string, font: string, fontSize: number): number => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('style', 'position:absolute;left:-10000px;top:0;visibility:hidden');
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.setAttribute('font-family', font);
  el.setAttribute('font-weight', String(WORD_WEIGHT));
  el.setAttribute('font-size', String(fontSize));
  el.textContent = text;
  svg.appendChild(el);
  document.body.appendChild(svg);
  try {
    // The advance width, or the ink if it sticks out past it (Caveat's slanted strokes).
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${WORD_WEIGHT} ${fontSize}px "${font}"`;
    return Math.max(el.getComputedTextLength(), ctx.measureText(text).actualBoundingBoxRight) / fontSize;
  } finally {
    svg.remove();
  }
};

// Rendered width in em of each text, measured once the style's font has loaded. The render waits via
// delayRender; a failure cancels the render instead of silently using the estimate. Only before the
// measurement has landed (a state no captured frame is taken in) the estimate of fit.ts is used.
const useMeasure = (texts: string[]): MeasureEm | undefined => {
  const {name, font, textScale} = useTheme();
  const key = JSON.stringify(texts);
  const [handle] = React.useState(() => delayRender(`Measuring thumbnail text (${font})`));
  const [widths, setWidths] = React.useState<{key: string; em: Record<string, number>} | null>(null);
  React.useEffect(() => {
    (async () => {
      const list = JSON.parse(key) as string[];
      await fontReady(name);
      await Promise.all(list.map((t) => document.fonts.load(`${WORD_WEIGHT} 100px "${font}"`, t)));
      const em: Record<string, number> = {};
      for (const t of list) em[t] = measureRendered(t, font, 100 * textScale);
      setWidths({key, em});
      continueRender(handle);
    })().catch((err) => cancelRender(err));
  }, [key, name, font, textScale, handle]);
  if (!widths || widths.key !== key) return undefined;
  return (t) => widths.em[t] ?? widthEm(t);
};

const Element: React.FC<{kind: ThumbnailSpec['element']; characters: number}> = ({kind, characters}) => {
  const {colors, font, textScale} = useTheme();
  const cx = RIGHT_X;
  // One character stands right under the element, so it sits higher to keep clear of the head.
  const cy = characters === 1 ? 490 : 560;
  const stroke = {fill: colors.accent, stroke: colors.texteFond, strokeWidth: 10, strokeLinejoin: 'round' as const};
  const arrow = (dir: 1 | -1) =>
    `M ${cx} ${cy - 140 * dir} L ${cx + 120} ${cy} L ${cx + 45} ${cy} L ${cx + 45} ${cy + 140 * dir} ` +
    `L ${cx - 45} ${cy + 140 * dir} L ${cx - 45} ${cy} L ${cx - 120} ${cy} Z`;
  switch (kind) {
    case 'arrow-up':
      return <g filter="url(#papier)"><path d={arrow(1)} {...stroke} /></g>;
    case 'arrow-down':
      return <g filter="url(#papier)"><path d={arrow(-1)} {...stroke} /></g>;
    case 'question':
    case 'exclamation':
      return (
        <g filter="url(#papier)">
          <circle cx={cx} cy={cy} r={130} {...stroke} />
          <text x={cx} y={cy + 70 * textScale} textAnchor="middle" fontFamily={font} fontWeight={600} fontSize={200 * textScale} fill="#ffffff">
            {kind === 'question' ? '?' : '!'}
          </text>
        </g>
      );
    case 'coin':
      return <g filter="url(#papier)"><Coin x={cx} y={cy} size={6} /></g>;
    default:
      return null;
  }
};

// The figure ("-18 Md€") as a tilted paper badge, top right.
const Badge: React.FC<{text: string; measure?: MeasureEm}> = ({text, measure}) => {
  const {colors, textScale, charWidth} = useTheme();
  const maxText = 480;
  const em = Math.max(1, measure ? measure(text) : widthEm(text) * narrowFactor(charWidth, textScale));
  const size = Math.min(110, maxText / (em * textScale));
  const width = em * size * textScale + 90;
  const y = 250;
  return (
    <g transform={`rotate(-6 ${RIGHT_X} ${y})`}>
      <g filter="url(#papier)">
        <rect x={RIGHT_X - width / 2} y={y - 85} width={width} height={170} rx={34} fill={colors.etiquette} stroke={colors.accent} strokeWidth={10} />
      </g>
      <Text x={RIGHT_X} y={y + 38 * textScale} size={size} bold color={colors.texte}>{text}</Text>
    </g>
  );
};

const ThumbnailView: React.FC<{spec: ThumbnailSpec; language?: string}> = ({spec, language}) => {
  const {name, colors, font, textScale, charWidth} = useTheme();
  const dark = name === 'nuit' || name === 'craie'; // light words on a dark sky, dark outline
  const words = spec.words.map((w) => upperCase(w, language));
  const figure = spec.figure ? spec.figure : undefined; // case kept: "-18 Md€", "5 kg" mean something
  const measure = useMeasure(figure ? [...words, figure] : words);
  const n = words.length;
  const size = fitWordSize(words, {maxWidth: TEXT_WIDTH, textScale, charWidth, measure});
  const lineHeight = size * textScale * LINE_HEIGHT;
  const top = CENTER_Y - Math.min(lineHeight * n, BLOCK_HEIGHT) / 2;
  return (
    <Canvas>
      <Background />
      {words.map((word, i) => {
        const y = top + (i + 0.82) * lineHeight;
        return (
          <g key={i}>
            {/* A heavy outline under the fill keeps the words legible on every style's sky. */}
            <text x={TEXT_X} y={y} textAnchor="start" fontFamily={font} fontWeight={600} fontSize={size * textScale}
              fill="none" stroke={dark ? colors.creme : colors.etiquette} strokeWidth={size * 0.12} strokeLinejoin="round">
              {word}
            </text>
            <Text x={TEXT_X} y={y} size={size} bold anchor="start" color={i === spec.highlight ? colors.accent : dark ? colors.texteFond : colors.texte}>
              {word}
            </Text>
          </g>
        );
      })}
      <Element kind={spec.element} characters={spec.characters} />
      {figure !== undefined && <Badge text={figure} measure={measure} />}
      <g filter="url(#papier)">
        {Array.from({length: spec.characters}).map((_, i) => (
          <Character key={i} x={spec.characters === 1 ? RIGHT_X : RIGHT_X - 120 + i * 240} y={975} size={2}
            color={PEOPLE_COLORS[i % PEOPLE_COLORS.length]!} elderly={i === 1} />
        ))}
      </g>
    </Canvas>
  );
};

export const Thumbnail: React.FC<{style: StyleName; spec: ThumbnailSpec; language?: string}> = ({style, spec, language}) => (
  <ThemeProvider style={style}>
    <AbsoluteFill style={{backgroundColor: getTheme(style).colors.creme}}>
      <ThumbnailView spec={spec} language={language} />
    </AbsoluteFill>
  </ThemeProvider>
);

// The bare background: reference image for the "stays inside the frame" test.
export const ThumbnailBackground: React.FC<{style: StyleName}> = ({style}) => (
  <ThemeProvider style={style}>
    <AbsoluteFill style={{backgroundColor: getTheme(style).colors.creme}}>
      <Canvas>
        <Background />
      </Canvas>
    </AbsoluteFill>
  </ThemeProvider>
);
