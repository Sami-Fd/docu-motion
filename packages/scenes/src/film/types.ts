import type {StyleName} from '../theme';
import type {SceneSpec} from '../schema';

export type SceneProps<S> = {spec: S; narration: string; durationFrames: number; index: number};

export type FilmScene = {
  id: string;
  narration: string;
  spec: SceneSpec;
  durationFrames: number;
  audioPath?: string;
};

export type FilmInput = {
  style: StyleName;
  subtitles: boolean;
  assetBase: string | null;
  scenes: FilmScene[];
};
