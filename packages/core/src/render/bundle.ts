import {bundle} from '@remotion/bundler';
import {createHash} from 'node:crypto';
import {promises as fs, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Resolved from this file's location so it works regardless of process.cwd().
export const SCENES_ENTRY = fileURLToPath(new URL('../../../scenes/src/index.ts', import.meta.url));

const BUNDLES_ROOT = path.join(os.tmpdir(), 'docu-motion-bundles');

/**
 * Deterministic working dir for a project's bundle: `<tmp>/docu-motion-bundles/<sha1(dir)[0..12]>`.
 * It holds `public/` (the staged assets) and `bundle/` (Remotion's output) and is wiped before every
 * re-bundle, so each project keeps at most one bundle on disk instead of one per process.
 */
export const bundleDirOf = (projectDir: string): string =>
  path.join(BUNDLES_ROOT, createHash('sha1').update(path.resolve(projectDir)).digest('hex').slice(0, 12));

type Entry = {assetsKey: string; promise: Promise<string>};
const cache = new Map<string, Entry>();

const checkAsset = (asset: string): string[] => {
  const parts = asset.split('/');
  if (asset === '' || path.isAbsolute(asset) || asset.includes('\\') || parts.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`Asset path "${asset}" must be a clean project-relative POSIX path`);
  }
  return parts;
};

async function build(projectDir: string, assets: string[]): Promise<string> {
  const dir = bundleDirOf(projectDir);
  await fs.rm(dir, {recursive: true, force: true});
  // Only the files the render references are staged: the project dir itself (with out/, previous
  // videos and stills) is never used as Remotion's public dir, which copies it whole into the bundle.
  const publicDir = path.join(dir, 'public');
  await fs.mkdir(publicDir, {recursive: true});
  for (const asset of assets) {
    const parts = checkAsset(asset);
    const to = path.join(publicDir, ...parts);
    await fs.mkdir(path.dirname(to), {recursive: true});
    await fs.copyFile(path.join(projectDir, ...parts), to);
  }
  return bundle({entryPoint: SCENES_ENTRY, publicDir, outDir: path.join(dir, 'bundle')});
}

/**
 * Bundle the scenes composition for a project, with `assets` (project-relative POSIX paths, e.g. the
 * audioPath values of toFilmInput) as the only files of Remotion's public dir. Cached per project
 * dir and asset list: a different list re-bundles. File contents are copied at bundle time, so
 * callers MUST call invalidateBundle(projectDir) after changing an already referenced file.
 */
export function bundleScenes(projectDir: string, assets: readonly string[] = []): Promise<string> {
  const key = path.resolve(projectDir);
  const list = [...new Set(assets)].sort();
  const assetsKey = JSON.stringify(list);
  const hit = cache.get(key);
  if (hit && hit.assetsKey === assetsKey) return hit.promise;
  // Let a build still in flight for this project finish before wiping its dir.
  const previous = hit?.promise.catch(() => undefined);
  const promise = (async () => {
    await previous;
    return build(key, list);
  })();
  const entry = {assetsKey, promise};
  promise.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  cache.set(key, entry);
  return promise;
}

const invalidationListeners: ((projectDir: string) => void)[] = [];
/** Registers a callback run with the resolved project dir whenever its bundle is invalidated. */
export const onBundleInvalidated = (fn: (projectDir: string) => void): void => void invalidationListeners.push(fn);

/** Drop a project's cached bundle and its files so the next render re-bundles its current files. */
export function invalidateBundle(projectDir: string): void {
  const key = path.resolve(projectDir);
  for (const fn of invalidationListeners) fn(key);
  cache.delete(key);
  try {
    rmSync(bundleDirOf(key), {recursive: true, force: true});
  } catch {
    // Best effort (e.g. a file still locked on Windows): the next build wipes the dir again.
  }
}
