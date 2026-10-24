const MIN_EXCERPT_LENGTH = 12;

function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\s\u00A0\u202F]+/g, ' ')
    .replace(/ ?" ?/g, '"')
    .trim()
    .toLowerCase();
}

/** True when the excerpt appears in the source, ignoring whitespace, quote style, dash style and case. */
export function excerptFound(excerpt: string, sourceText: string): boolean {
  const e = normalize(excerpt);
  if (e.length < MIN_EXCERPT_LENGTH) return false;
  return normalize(sourceText).includes(e);
}
