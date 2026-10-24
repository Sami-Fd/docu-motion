// Pure text-layout helpers (no React), shared by the scene components.

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

/**
 * Splits `text` into at most two lines at the word break that makes the longer line shortest.
 * A single word stays on one line. Callers shrink the font size to fit the longer line.
 */
export const twoLines = (text: string): string[] => {
  const words = text.split(/\s+/).filter((w) => w !== '');
  if (words.length <= 1) return words.length === 1 ? [words[0]!] : [];
  let best: string[] = [words.join(' ')];
  let bestLen = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' ');
    const b = words.slice(k).join(' ');
    const len = Math.max(a.length, b.length);
    if (len < bestLen) {
      bestLen = len;
      best = [a, b];
    }
  }
  return best;
};
