import {bundle} from '@remotion/bundler';
import {fileURLToPath} from 'node:url';

// Resolved from this file's location so it works regardless of process.cwd().
export const SCENES_ENTRY = fileURLToPath(new URL('../../../scenes/src/index.ts', import.meta.url));

const cache = new Map<string, Promise<string>>();

/** Bundle the scenes composition with `publicDir` as Remotion's public dir. Cached per publicDir. */
export function bundleScenes(publicDir: string): Promise<string> {
  let p = cache.get(publicDir);
  if (!p) {
    p = bundle({entryPoint: SCENES_ENTRY, publicDir});
    p.catch(() => cache.delete(publicDir));
    cache.set(publicDir, p);
  }
  return p;
}
