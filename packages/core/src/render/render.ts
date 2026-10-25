import {promises as fs} from 'node:fs';
import path from 'node:path';
import {makeCancelSignal, renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import type {Project} from '../project/schema.js';
import {bundleScenes} from './bundle.js';
import {filmAssets, toFilmInput} from './toFilmInput.js';

export async function renderSceneStill(
  projectDir: string,
  p: Project,
  sceneIndex: number,
  atRatio = 0.8,
  outputDir = path.join(projectDir, 'out', 'stills'),
): Promise<string> {
  const scene = p.scenes[sceneIndex];
  if (!scene) throw new Error(`Scene index ${sceneIndex} is out of range (${p.scenes.length} scenes)`);
  const film = toFilmInput(p, projectDir, null);
  const serveUrl = await bundleScenes(projectDir, filmAssets(film));
  const inputProps = {...film, sceneIndex};
  const composition = await selectComposition({serveUrl, id: 'SceneStill', inputProps});
  const frame = Math.floor(atRatio * (composition.durationInFrames - 1));
  const output = path.join(outputDir, `${scene.id}.png`);
  await fs.mkdir(path.dirname(output), {recursive: true});
  await renderStill({composition, serveUrl, inputProps, frame, output});
  return output;
}

export async function renderVideo(
  projectDir: string,
  p: Project,
  opts: {onProgress?: (r: number) => void; signal?: AbortSignal; concurrency?: number} = {},
): Promise<string> {
  const {onProgress, signal, concurrency} = opts;
  const cancelled = () => new Error('Render cancelled');
  if (signal?.aborted) throw cancelled();
  const {cancelSignal, cancel} = makeCancelSignal();
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    const inputProps = toFilmInput(p, projectDir, null);
    const serveUrl = await bundleScenes(projectDir, filmAssets(inputProps));
    if (signal?.aborted) throw cancelled();
    const composition = await selectComposition({serveUrl, id: 'Film', inputProps});
    const output = path.join(projectDir, 'out', 'video.mp4');
    await fs.mkdir(path.dirname(output), {recursive: true});
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: 'h264',
      outputLocation: output,
      concurrency: concurrency ?? null,
      cancelSignal,
      onProgress: ({progress}) => onProgress?.(progress),
    });
    return output;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
