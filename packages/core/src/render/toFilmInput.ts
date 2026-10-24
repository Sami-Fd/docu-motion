import {statSync} from 'node:fs';
import path from 'node:path';
import type {FilmInput} from '@docu-motion/scenes';
import type {Project} from '../project/schema.js';

/**
 * Turn a project-relative audio path from project.json into the clean POSIX path Remotion's
 * staticFile() expects ("voice/s0.mp3"), or null when it is unusable: `\` separators are accepted,
 * a leading "./" is dropped, and the file must exist inside projectDir (no "..", no path outside it).
 * An absolute path pointing inside projectDir is converted to its project-relative form.
 */
export function resolveAudioPath(projectDir: string, raw: string): string | null {
  const root = path.resolve(projectDir);
  const abs = path.resolve(root, raw.replace(/\\/g, '/'));
  const rel = path.relative(root, abs);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  try {
    if (!statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return rel.split(path.sep).join('/');
}

export function toFilmInput(p: Project, projectDir: string, assetBase: string | null): FilmInput {
  return {
    style: p.brief.style,
    language: p.brief.language,
    subtitles: true,
    assetBase,
    scenes: p.scenes.map((s) => {
      let audioPath: string | undefined;
      if (s.audio) {
        audioPath = resolveAudioPath(projectDir, s.audio.path) ?? undefined;
        if (!audioPath) {
          console.warn(
            `Scene ${s.id}: audio file "${s.audio.path}" is missing or outside the project folder, rendering it silent.`,
          );
        }
      }
      return {
        id: s.id,
        narration: s.narration,
        spec: s.spec,
        durationFrames: s.durationFrames,
        ...(audioPath ? {audioPath} : {}),
      };
    }),
  };
}

/** The project-relative audio files a FilmInput references (what the bundle's public dir must hold). */
export const filmAssets = (input: FilmInput): string[] =>
  [...new Set(input.scenes.flatMap((s) => (s.audioPath ? [s.audioPath] : [])))].sort();
