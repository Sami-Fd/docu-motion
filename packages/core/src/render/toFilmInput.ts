import {existsSync} from 'node:fs';
import path from 'node:path';
import type {FilmInput} from '@docu-motion/scenes';
import type {Project} from '../project/schema.js';

export function toFilmInput(p: Project, projectDir: string, assetBase: string | null): FilmInput {
  return {
    style: p.brief.style,
    language: p.brief.language,
    subtitles: true,
    assetBase,
    scenes: p.scenes.map((s) => {
      let audioPath: string | undefined;
      if (s.audio) {
        if (existsSync(path.join(projectDir, s.audio.path))) audioPath = s.audio.path;
        else console.warn(`Scene ${s.id}: audio file "${s.audio.path}" is missing, rendering it silent.`);
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
