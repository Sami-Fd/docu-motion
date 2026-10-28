import {z} from 'zod';
import type {Project} from '../project/schema.js';

const FPS = 30;
export const MIN_CHAPTER_SECONDS = 10;
export const MIN_CHAPTERS = 3;
export const TITLE_MAX = 70;

const codePointLength = (s: string) => [...s].length;

export const YoutubeOutputSchema = z.object({
  titles: z
    .array(
      z
        .string()
        .min(1)
        .max(TITLE_MAX * 2) // UTF-16 upper bound of the limit; the exact check counts code points
        .refine((t) => codePointLength(t) <= TITLE_MAX, {message: `must be at most ${TITLE_MAX} characters`}),
    )
    .length(3),
  hook: z.string().min(1).max(400).describe('2 to 3 sentences'),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]{2,30}$/u, 'must look like #word')).min(3).max(5),
});
export type YoutubeOutput = z.infer<typeof YoutubeOutputSchema>;

export type Chapter = {t: string; label: string};

function formatTime(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * YouTube chapters from the real scene durations. YouTube wants >= 3 chapters of >= 10 s starting at 0:00:
 * a scene under 10 s merges into the previous chapter (which keeps its label), and so does any scene that
 * would leave the open chapter under 10 s. Fewer than 3 chapters left means none at all.
 */
export function chapters(p: Project): Chapter[] {
  const out: {startFrame: number; label: string}[] = [];
  let frame = 0;
  for (const s of p.scenes) {
    const last = out.at(-1);
    const longEnough = s.durationFrames >= MIN_CHAPTER_SECONDS * FPS;
    if (!last || (longEnough && frame - last.startFrame >= MIN_CHAPTER_SECONDS * FPS)) {
      out.push({startFrame: frame, label: s.spec.title});
    }
    frame += s.durationFrames;
  }
  if (out.length < MIN_CHAPTERS) return [];
  return out.map((c) => ({t: formatTime(c.startFrame / FPS), label: c.label}));
}

/** The sources cited by the facts the scenes use: deduped, in order of first use. */
function usedSources(p: Project): Project['sources'] {
  const seen = new Set<string>();
  const out: Project['sources'] = [];
  for (const scene of p.scenes) {
    for (const id of scene.factIds) {
      const sid = p.facts.find((f) => f.id === id)?.sourceId;
      const src = sid ? p.sources.find((s) => s.id === sid) : undefined;
      if (src && !seen.has(src.id)) {
        seen.add(src.id);
        out.push(src);
      }
    }
  }
  return out;
}

/** The YouTube description: hook, chapters, sources, hashtags, separated by blank lines. */
export function describe(p: Project, out: YoutubeOutput, ch: Chapter[]): string {
  const blocks = [out.hook];
  if (ch.length > 0) blocks.push(ch.map((c) => `${c.t} ${c.label}`).join('\n'));
  const sources = usedSources(p);
  if (sources.length > 0) blocks.push(['Sources:', ...sources.map((s) => `- ${s.title} — ${s.uri}`)].join('\n'));
  blocks.push(out.hashtags.join(' '));
  return blocks.join('\n\n');
}
