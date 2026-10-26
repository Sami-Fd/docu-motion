import React from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {measureText} from '@remotion/layout-utils';
import {ThemeProvider, getTheme, useTheme, type StyleName} from '../theme';
import {Background, Canvas, Character, Coin, Text} from '../kit';
import {PEOPLE_COLORS} from '../types/common';
import {BLOCK_HEIGHT, LINE_HEIGHT, fitWordSize, narrowFactor, widthEm, type MeasureEm} from './fit';
import type {ThumbnailSpec} from './schema';

// Layout in the 1920x1080 canvas (the 1280x720 output is a 2/3 scale, so its 40 px inset is 60 here).
const TEXT_X = 110;
const TEXT_WIDTH = 1040; // the left 60 % of the frame, minus the margin
const CENTER_Y = 540;
const RIGHT_X = 1530;
const WORD_WEIGHT = 600;

// Real width in em of each text, measured once the style's font has loaded (the render waits via delayRender).
// Until then, or if measuring fails, the estimate of fit.ts is used.
const useMeasure = (texts: string[]): MeasureEm | undefined => {
  const {font, textScale} = useTheme();
  const key = JSON.stringify(texts);
  const [widths, setWidths] = React.useState<{key: string; em: Record<string, number>} | null>(null);
  React.useEffect(() => {
    const handle = delayRender(`Measuring thumbnail text (${font})`);
    (async () => {
      try {
        const list = JSON.parse(key) as string[];
        await Promise.all(list.map((t) => document.fonts.load(`${WORD_WEIGHT} 100px "${font}"`, t)));
        const em: Record<string, number> = {};
        for (const t of list) {
          em[t] = measureText({text: t, fontFamily: font, fontWeight: String(WORD_WEIGHT), fontSize: 100 * textScale}).width / (100 * textScale);
        }
        setWidths({key, em});
      } catch {
        setWidths(null);
      } finally {
        continueRender(handle);
      }
    })();
  }, [key, font, textScale]);
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
  const upper = (t: string) => t.toLocaleUpperCase(language); // locale-aware (Turkish i), ß becomes SS
  const words = spec.words.map(upper);
  const figure = spec.figure ? upper(spec.figure) : undefined;
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
