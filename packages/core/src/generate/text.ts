/** Trim, then cut to at most `max` characters on a word boundary (hard cut if one long word). */
export function cutOnWord(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  if (/\s/.test(t.charAt(max))) return head.trimEnd();
  const ws = head.search(/\s\S*$/);
  return (ws > 0 ? head.slice(0, ws) : head).trimEnd() || head;
}
