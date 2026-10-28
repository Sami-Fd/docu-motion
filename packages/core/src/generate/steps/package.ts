import {promises as fs} from 'node:fs';
import path from 'node:path';
import {THUMBNAIL_EXAMPLES, ThumbnailSpecSchema, type ThumbnailSpec} from '@docu-motion/scenes';
import {z} from 'zod';
import type {Project} from '../../project/schema.js';
import {renderThumbnail as defaultRenderThumbnail} from '../../render/render.js';
import type {Step} from '../context.js';
import {proposeThumbnails, writeYoutube} from '../prompts.js';
import {chapters, cleanLine, describeFitted, YoutubeOutputSchema} from '../youtube.js';

export const ThumbnailsOutputSchema = z.object({options: z.array(ThumbnailSpecSchema).length(3)});

export const JPEG_WARNING = 'Thumbnail saved as JPEG (PNG over 2 MB)';
export const JPEG_STILL_BIG_WARNING = 'Thumbnail still over 2 MB as JPEG';
export const CHAPTERS_WARNING = 'Too few chapters for YouTube (need 3 of ≥ 10 s)';
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

export type RenderThumbnail = (projectDir: string, p: Project, spec: ThumbnailSpec, out: string) => Promise<string>;

const sizeOf = async (file: string) => (await fs.stat(file)).size;
const exists = (file: string) => fs.stat(file).then(() => true, () => false);

/**
 * Makes option `index` the thumbnail: copies out/thumbnail-<index+1>.png to out/thumbnail.png, re-rendering it as
 * a JPEG (out/thumbnail.jpg) when the PNG is over 2 MB. Removes the stale file of the other format, sets
 * `thumbnail.chosen` and `thumbnail.file`, and records or clears the JPEG warning in `youtube.warnings`.
 * Shared by the package step and Task 6's chooseThumbnail.
 */
export async function applyThumbnailChoice(
  projectDir: string,
  p: Project,
  index: number,
  deps: {renderThumbnail?: RenderThumbnail} = {},
): Promise<Project> {
  const render = deps.renderThumbnail ?? defaultRenderThumbnail;
  const options = p.thumbnail?.options ?? [];
  const spec = options[index];
  if (!spec) throw new Error(`Thumbnail ${index + 1} does not exist (${options.length} options)`);
  const outDir = path.join(projectDir, 'out');
  const png = path.join(outDir, 'thumbnail.png');
  const jpg = path.join(outDir, 'thumbnail.jpg');
  const warnings: string[] = [];
  await fs.rm(png, {force: true});
  await fs.rm(jpg, {force: true});
  await fs.copyFile(path.join(outDir, `thumbnail-${index + 1}.png`), png);
  let file = 'out/thumbnail.png';
  if ((await sizeOf(png)) > MAX_THUMBNAIL_BYTES) {
    await fs.rm(png, {force: true});
    await render(projectDir, p, spec, jpg);
    file = 'out/thumbnail.jpg';
    warnings.push(JPEG_WARNING);
    if ((await sizeOf(jpg)) > MAX_THUMBNAIL_BYTES) warnings.push(JPEG_STILL_BIG_WARNING);
  }
  const mine = [JPEG_WARNING, JPEG_STILL_BIG_WARNING];
  return {
    ...p,
    thumbnail: {options, chosen: index, file},
    ...(p.youtube ? {youtube: {...p.youtube, warnings: [...p.youtube.warnings.filter((w) => !mine.includes(w)), ...warnings]}} : {}),
  };
}

export function packageStep(deps: {renderThumbnail?: RenderThumbnail} = {}): Step {
  const render = deps.renderThumbnail ?? defaultRenderThumbnail;
  return async (p, ctx) => {
    ctx.signal?.throwIfAborted();
    const outDir = path.join(ctx.projectDir, 'out');
    await fs.mkdir(outDir, {recursive: true});
    const summaries = p.scenes.map((s) => ({title: s.spec.title, narration: s.narration}));

    // 1. Thumbnail: 3 options rendered, the first one chosen. A re-run keeps the options and the user's choice.
    let options: ThumbnailSpec[];
    let chosen = 0;
    if (p.thumbnail && p.thumbnail.options.length === 3) {
      options = p.thumbnail.options;
      chosen = p.thumbnail.chosen;
    } else {
      ({options} = await ctx.llm.generateObject({
        schema: ThumbnailsOutputSchema,
        ...proposeThumbnails(p.brief.topic, p.brief.language, p.brief.style, summaries, THUMBNAIL_EXAMPLES),
        signal: ctx.signal,
      }));
    }
    for (let i = 0; i < options.length; i++) {
      ctx.signal?.throwIfAborted();
      const file = path.join(outDir, `thumbnail-${i + 1}.png`);
      if (!(await exists(file))) await render(ctx.projectDir, p, options[i]!, file);
      ctx.onProgress({step: 'package', ratio: (i + 1) / (options.length + 2)});
    }
    const withThumb = await applyThumbnailChoice(ctx.projectDir, {...p, thumbnail: {options, chosen, file: ''}}, chosen, {renderThumbnail: render});
    const warnings: string[] = withThumb.thumbnail!.file.endsWith('.jpg') ? [JPEG_WARNING] : [];

    // 2. YouTube kit: a re-run keeps the titles, hook and hashtags and recomputes the rest.
    ctx.signal?.throwIfAborted();
    const kept = YoutubeOutputSchema.safeParse({titles: p.youtube?.titles, hook: p.youtube?.hook, hashtags: p.youtube?.hashtags});
    const yt = kept.success
      ? kept.data
      : await ctx.llm.generateObject({
          schema: YoutubeOutputSchema,
          ...writeYoutube(p.brief.topic, p.brief.language, summaries),
          signal: ctx.signal,
        });
    const ch = chapters(p);
    if (ch.length === 0) warnings.push(CHAPTERS_WARNING);
    const fitted = describeFitted(p, yt, ch);
    warnings.push(...fitted.warnings);
    const description = fitted.text;

    // 3. Text files.
    const titles = yt.titles.map((t, i) => `${i + 1}. ${cleanLine(t)}`).join('\n');
    await fs.writeFile(path.join(outDir, 'youtube.txt'), `${titles}\n\n${description}\n`, 'utf8');
    await fs.writeFile(path.join(outDir, 'narration.txt'), `${p.scenes.map((s) => s.narration).join('\n\n')}\n`, 'utf8');
    ctx.onProgress({step: 'package', ratio: 1});

    return {
      ...p,
      thumbnail: withThumb.thumbnail,
      youtube: {titles: yt.titles.map(cleanLine), hook: yt.hook, description, chapters: ch, hashtags: yt.hashtags, warnings},
    };
  };
}
