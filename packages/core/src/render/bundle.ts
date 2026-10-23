import {bundle} from '@remotion/bundler';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Resolved from this file's location so it works regardless of process.cwd().
export const SCENES_ENTRY = fileURLToPath(new URL('../../../scenes/src/index.ts', import.meta.url));

const cache = new Map<string, Promise<string>>();

const keyOf = (publicDir: string) => path.resolve(publicDir);

/**
 * Bundle the scenes composition with `publicDir` as Remotion's public dir. Cached per publicDir.
 * Remotion copies the public dir into the bundle at build time, so callers MUST call
 * invalidateBundle(publicDir) after adding or changing files (e.g. audio) in the project dir.
 */
export function bundleScenes(publicDir: string): Promise<string> {
  const key = keyOf(publicDir);
  let p = cache.get(key);
  if (!p) {
    p = bundle({entryPoint: SCENES_ENTRY, publicDir: key});
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Drop the cached bundle for a project dir so the next render re-bundles its current files. */
export function invalidateBundle(publicDir: string): void {
  cache.delete(keyOf(publicDir));
}
