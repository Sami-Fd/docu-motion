// Pure sizing of the thumbnail words (no React), so it can be unit-tested.

export const MIN_WORD_SIZE = 64;
export const MAX_WORD_SIZE = 280;
// Line height as a multiple of the font size, and the vertical room for the whole word block (1920x1080 units).
export const LINE_HEIGHT = 1.1;
export const BLOCK_HEIGHT = 800;
// Theme charWidth (per nominal px, textScale included) of the widest style fonts: the reference of the estimate.
const REF_CHAR_WIDTH = 0.6;
// The words are drawn with a light outline of 0.12 em (stroke width), half of it outside each side.
export const OUTLINE_EM = 0.12;

/** Width of `text` in em of the effective font size (textScale included), e.g. measured in the browser. */
export type MeasureEm = (text: string) => number;

/** Narrow-font correction of the estimate (Caveat), 1 for the widest fonts. */
export const narrowFactor = (charWidth: number, textScale: number): number => Math.min(1, charWidth / textScale / REF_CHAR_WIDTH);

/** Conservative advance of one character, in em, for any of the four style fonts (W and M are the widest). */
export const glyphEm = (ch: string): number => {
  if (ch === 'W' || ch === 'M') return 1.05;
  if (ch === ' ') return 0.35;
  if (ch.codePointAt(0)! > 0xffff) return 1.3; // emoji
  if (ch !== ch.toLowerCase()) return 0.76; // other capitals
  return 0.62;
};

export const widthEm = (text: string): number => [...text].reduce((sum, ch) => sum + glyphEm(ch), 0);

/**
 * Largest font size (nominal, before `textScale`) at which every word fits `maxWidth` and the block of
 * words fits `BLOCK_HEIGHT`. Never below `MIN_WORD_SIZE`: a very long word then overflows its zone
 * rather than becoming unreadable.
 */
export const fitWordSize = (
  words: string[],
  {maxWidth, textScale, charWidth = REF_CHAR_WIDTH * textScale, measure}:
    {maxWidth: number; textScale: number; charWidth?: number; measure?: MeasureEm},
): number => {
  // Real measured widths when available, else the conservative estimate (narrow fonts get less room per glyph).
  const em = measure ?? ((w: string) => widthEm(w) * narrowFactor(charWidth, textScale));
  const widest = Math.max(1, ...words.map(em)) + OUTLINE_EM;
  const byWidth = maxWidth / (widest * textScale);
  const byHeight = BLOCK_HEIGHT / (words.length * LINE_HEIGHT * textScale);
  return Math.max(MIN_WORD_SIZE, Math.min(MAX_WORD_SIZE, byWidth, byHeight));
};
