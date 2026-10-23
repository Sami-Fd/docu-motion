/** Scene length actually used everywhere (metadata and Series): at least 1 frame. */
export const clampFrames = (durationFrames: number): number => Math.max(1, Math.floor(durationFrames));

/** Fade in/out opacity: 10-frame ramps, shrunk for short scenes; never throws. */
export function fadeOpacity(frame: number, durationFrames: number): number {
  const d = clampFrames(durationFrames);
  const ramp = Math.min(10, Math.floor(d / 2));
  if (ramp < 1) return 1;
  return Math.max(0, Math.min(1, frame / ramp, (d - frame) / ramp));
}

/** Sentence shown at `frame`, each sentence lasting proportionally to its length. Null if no text. */
export function subtitleAt(text: string, durationFrames: number, frame: number): string | null {
  const sentences = text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter((s) => s !== '');
  if (sentences.length === 0) return null;
  const total = sentences.reduce((a, s) => a + s.length, 0);
  const usable = Math.max(1, clampFrames(durationFrames) - 20);
  let start = 5;
  for (const s of sentences) {
    const d = (s.length / total) * usable;
    if (frame < start + d) return s;
    start += d;
  }
  return sentences[sentences.length - 1] ?? null;
}
