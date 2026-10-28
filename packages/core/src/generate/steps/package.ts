import {promises as fs} from 'node:fs';
import path from 'node:path';
import {THUMBNAIL_EXAMPLES, ThumbnailSpecSchema, type ThumbnailSpec} from '@docu-motion/scenes';
import {z} from 'zod';
import type {Project} from '../../project/schema.js';
import {renderThumbnail as defaultRenderThumbnail} from '../../render/render.js';
import type {Step} from '../context.js';
import {proposeThumbnails, writeYoutube} from '../prompts.js';
import {chapters, describe, YoutubeOutputSchema} from '../youtube.js';

export const ThumbnailsOutputSchema = z.object({options: z.array(ThumbnailSpecSchema).length(3)});

export const JPEG_WARNING = 'Thumbnail saved as JPEG (PNG over 2 MB)';
export const JPEG_STILL_BIG_WARNING = 'Thumbnail still over 2 MB as JPEG';
export const CHAPTERS_WARNING = 'Too few chapters for YouTube (need 3 of ≥ 10 s)';
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

export type RenderThumbnail = (projectDir: string, p: Project, spec: ThumbnailSpec, out: string) => Promise<string>;

const sizeOf = async (file: string) => (await fs.stat(file)).size;

export function packageStep(deps: {renderThumbnail?: RenderThumbnail} = {}): Step {
  const render = deps.renderThumbnail ?? defaultRenderThumbnail;
  return async (p, ctx) => {
    ctx.signal?.throwIfAborted();
    const outDir = path.join(ctx.projectDir, 'out');
    await fs.mkdir(outDir, {recursive: true});
    const summaries = p.scenes.map((s) => ({title: s.spec.title, narration: s.narration}));
    const warnings: string[] = [];

    // 1. Thumbnail: 3 options rendered, the first one chosen.
    const {options} = await ctx.llm.generateObject({
      schema: ThumbnailsOutputSchema,
      ...proposeThumbnails(p.brief.topic, p.brief.language, p.brief.style, summaries, THUMBNAIL_EXAMPLES),
      signal: ctx.signal,
    });
    for (let i = 0; i < options.length; i++) {
      ctx.signal?.throwIfAborted();
      await render(ctx.projectDir, p, options[i]!, path.join(outDir, `thumbnail-${i + 1}.png`));
      ctx.onProgress({step: 'package', ratio: (i + 1) / (options.length + 2)});
    }
    const chosen = 0;
    const png = path.join(outDir, 'thumbnail.png');
    const jpg = path.join(outDir, 'thumbnail.jpg');
    await fs.rm(png, {force: true});
    await fs.rm(jpg, {force: true});
    await fs.copyFile(path.join(outDir, `thumbnail-${chosen + 1}.png`), png);
    let file = 'out/thumbnail.png';
    if ((await sizeOf(png)) > MAX_THUMBNAIL_BYTES) {
      await fs.rm(png, {force: true});
      await render(ctx.projectDir, p, options[chosen]!, jpg);
      file = 'out/thumbnail.jpg';
      warnings.push(JPEG_WARNING);
      if ((await sizeOf(jpg)) > MAX_THUMBNAIL_BYTES) warnings.push(JPEG_STILL_BIG_WARNING);
    }

    // 2. YouTube kit.
    ctx.signal?.throwIfAborted();
    const yt = await ctx.llm.generateObject({
      schema: YoutubeOutputSchema,
      ...writeYoutube(p.brief.topic, p.brief.language, summaries),
      signal: ctx.signal,
    });
    const ch = chapters(p);
    if (ch.length === 0) warnings.push(CHAPTERS_WARNING);
    const description = describe(p, yt, ch);

    // 3. Text files.
    const titles = yt.titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
    await fs.writeFile(path.join(outDir, 'youtube.txt'), `${titles}\n\n${description}\n`, 'utf8');
    await fs.writeFile(path.join(outDir, 'narration.txt'), `${p.scenes.map((s) => s.narration).join('\n\n')}\n`, 'utf8');
    ctx.onProgress({step: 'package', ratio: 1});

    return {
      ...p,
      thumbnail: {options, chosen, file},
      youtube: {titles: yt.titles, description, chapters: ch, hashtags: yt.hashtags, warnings},
    };
  };
}
