import {z} from 'zod';
import type {Project} from '../project/schema.js';

const FPS = 30;
export const MIN_CHAPTER_SECONDS = 10;
export const MIN_CHAPTERS = 3;
export const TITLE_MAX = 70;

const codePointLength = (s: string) => [...s.normalize('NFC')].length;
const HASHTAG = /^#[\p{L}\p{N}_]{2,30}$/u;
export const DESCRIPTION_MAX_BYTES = 5000;
export const DESCRIPTION_TRIMMED_WARNING = "Description trimmed to fit YouTube's 5000 byte limit (sources shortened)";
export const DESCRIPTION_OVER_WARNING = "Description over YouTube's 5000 byte limit";

export const YoutubeOutputSchema = z.object({
  titles: z
    .array(
      z
        .string()
        .min(1)
        .max(TITLE_MAX * 2) // UTF-16 upper bound of the limit; the exact check counts NFC code points
        .describe(`At most ${TITLE_MAX} characters`)
        .refine((t) => codePointLength(t) <= TITLE_MAX, {message: `must be at most ${TITLE_MAX} characters`}),
    )
    .length(3),
  hook: z.string().min(1).max(400).describe('2 to 3 sentences'),
  // The Unicode rule lives in a refine, not a regex: JSON Schema patterns carry no "u" flag, so \p{L} would not mean letters there.
  hashtags: z
    .array(
      z
        .string()
        .max(61)
        .describe('A hashtag: "#" followed by 2 to 30 letters, digits or underscores, no spaces')
        .refine((h) => HASHTAG.test(h), {message: 'must look like #word'}),
    )
    .min(3)
    .max(5),
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
      out.push({startFrame: frame, label: cleanLine(s.spec.title)});
    }
    frame += s.durationFrames;
  }
  if (out.length < MIN_CHAPTERS) return [];
  return out.map((c) => ({t: formatTime(c.startFrame / FPS), label: c.label}));
}

/** YouTube rejects "<" and ">"; a newline would break a chapter or source line. */
const noBrackets = (t: string) => t.replace(/[<>]/g, '');
export const cleanLine = (t: string) => noBrackets(t).replace(/\s+/g, ' ').trim();

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

const baseName = (t: string) => t.split(/[\\/]/).filter(Boolean).at(-1) ?? t;

/** A file source shows its title or file name only: its uri is a local path or file URI that must not be published. */
function sourceLine(s: Project['sources'][number]): string {
  const title = cleanLine(s.title);
  if (s.kind === 'file') return `- ${cleanLine(baseName(/[\\/]/.test(title) || title === '' ? title || s.uri : title))}`;
  return `- ${title} — ${cleanLine(s.uri)}`;
}

/** The YouTube description: hook, chapters, sources, hashtags, separated by blank lines. `maxSources` caps the sources list. */
export function describe(p: Project, out: YoutubeOutput, ch: Chapter[], maxSources = Infinity): string {
  const blocks = [noBrackets(out.hook).trim()];
  if (ch.length > 0) blocks.push(ch.map((c) => `${c.t} ${cleanLine(c.label)}`).join('\n'));
  const sources = usedSources(p).slice(0, maxSources);
  if (sources.length > 0) blocks.push(['Sources:', ...sources.map(sourceLine)].join('\n'));
  blocks.push(out.hashtags.join(' '));
  return blocks.join('\n\n');
}

/** Like `describe`, but drops trailing sources until the description fits YouTube's 5000 bytes; says what it did. */
export function describeFitted(p: Project, out: YoutubeOutput, ch: Chapter[]): {text: string; warnings: string[]} {
  const bytes = (t: string) => Buffer.byteLength(t, 'utf8');
  const full = describe(p, out, ch);
  if (bytes(full) <= DESCRIPTION_MAX_BYTES) return {text: full, warnings: []};
  for (let n = usedSources(p).length - 1; n >= 0; n--) {
    const text = describe(p, out, ch, n);
    if (bytes(text) <= DESCRIPTION_MAX_BYTES) return {text, warnings: [DESCRIPTION_TRIMMED_WARNING]};
  }
  return {text: describe(p, out, ch, 0), warnings: [DESCRIPTION_TRIMMED_WARNING, DESCRIPTION_OVER_WARNING]};
}
