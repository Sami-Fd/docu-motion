import React from 'react';
import {Text} from '../kit';
import {useTheme} from '../theme';

// Colours from the skill's example scenes (fixed across styles, like BLEU / ROUGE / COULEURS_GENS there).
export const BLUE = '#3f6fb5';
export const RED = '#d9534f';
export const PEOPLE_COLORS = ['#e8735a', '#4f9a5c', '#3f6fb5', '#f0a830', '#9b6fc2', '#4fa3e0', '#d9534f', '#6fb36b'];
export const SERIES_COLORS = [BLUE, '#e8735a', '#f0a830', '#4f9a5c', '#b7a28c', '#9b6fc2', '#4fa3e0', '#d9534f'];
export const ELDERLY_COLOR = '#b7a28c';

export const useCharWidth = (): number => useTheme().charWidth;

/** Largest font size <= maxSize at which `text` fits in `maxWidth` px. */
export const fitSize = (text: string, maxWidth: number, maxSize: number, charWidth: number): number =>
  Math.min(maxSize, maxWidth / Math.max(1, text.length * charWidth));

/** Greedy word wrap to lines of at most `maxChars` characters (a longer word gets its own line). */
export const wrapText = (text: string, maxChars: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
};

/** Number of decimals of `n` as written (capped at 3), so animated values keep a stable width. */
export const decimalsOf = (n: number): number => {
  const s = String(n);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(3, s.length - dot - 1);
};

export const formatNumber = (n: number, locale: string, decimals = decimalsOf(n)): string => {
  try {
    return new Intl.NumberFormat(locale, {minimumFractionDigits: decimals, maximumFractionDigits: decimals}).format(n);
  } catch {
    return new Intl.NumberFormat('fr', {minimumFractionDigits: decimals, maximumFractionDigits: decimals}).format(n);
  }
};

export const formatPercent = (n: number, locale: string): string => {
  const opts = {style: 'percent', maximumFractionDigits: decimalsOf(n)} as const;
  try {
    return new Intl.NumberFormat(locale, opts).format(n / 100);
  } catch {
    return new Intl.NumberFormat('fr', opts).format(n / 100);
  }
};

/** Source line, bottom right of the safe area (the skill's `Source`). */
export const Source: React.FC<{children?: string}> = ({children}) =>
  children ? (
    <Text x={1850} y={880} size={24} anchor="end" onBackground opacity={0.75}>
      {`Source: ${children}`}
    </Text>
  ) : null;

/** Paper card centred on (x, y) (the skill's `Carte`). */
export const Card: React.FC<{x: number; y: number; w: number; h: number; color?: string; rot?: number}> = ({
  x, y, w, h, color, rot = 0,
}) => {
  const {colors} = useTheme();
  return (
    <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={24} fill={color ?? colors.etiquette}
      transform={`rotate(${rot} ${x} ${y})`} />
  );
};
