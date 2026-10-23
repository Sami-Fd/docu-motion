/** Lowercase, accent-free, punctuation-free, single-spaced form used for cue matching. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Frame (relative to the scene start) at which an element should appear. */
export function cueFrame(
  narration: string,
  cue: string | undefined,
  durationFrames: number,
  fallbackIndex: number,
): number {
  const text = normalise(narration);
  const needle = cue ? normalise(cue) : '';
  if (needle && text.length > 0) {
    const i = text.indexOf(needle);
    if (i >= 0) {
      return Math.max(0, Math.round((i / text.length) * (durationFrames - 15) * 0.85));
    }
  }
  return Math.max(0, Math.min(15 + fallbackIndex * 12, durationFrames - 20));
}

export function estimateDurationFrames(text: string): number {
  const trimmed = text.trim();
  const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
  return Math.ceil((words / 2.4 + 1.5) * 30);
}

export function durationFromAudio(seconds: number): number {
  return Math.ceil((seconds + 1.2) * 30);
}
