import type {StyleName} from '../theme';
import type {SceneSpec} from '../schema';

/** `language` is a BCP 47 tag (e.g. 'fr') used to format numbers on screen. */
export type SceneProps<S> = {spec: S; narration: string; durationFrames: number; index: number; language: string};

export type FilmScene = {
  id: string;
  narration: string;
  spec: SceneSpec;
  durationFrames: number;
  audioPath?: string;
};

export type FilmInput = {
  style: StyleName;
  /** BCP 47 language of the project (number formatting). Defaults to 'fr' when absent. */
  language: string;
  subtitles: boolean;
  assetBase: string | null;
  scenes: FilmScene[];
};
