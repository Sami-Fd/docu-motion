import {promises as fs} from 'node:fs';
import path from 'node:path';
import {saveProject} from '../project/store.js';
import {PROJECT_VERSION, type Project, type ProviderRef, type StyleName} from '../project/schema.js';

export type NewProjectInput = {
  topic: string;
  style: StyleName;
  language: string;
  targetMinutes: number;
  provider: ProviderRef;
  webSearch: 'off' | 'native' | 'tavily' | 'brave';
  sources: string[];
  voice: Project['voice'];
};

const MAX_SLUG = 32;
const DIR_SLUG = 26;

export function slugify(topic: string): string {
  let s = topic
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > MAX_SLUG) {
    const cut = s.slice(0, MAX_SLUG + 1);
    const at = cut.lastIndexOf('-');
    s = at > 0 ? cut.slice(0, at) : cut.slice(0, MAX_SLUG);
    s = s.replace(/-+$/g, '');
  }
  return s || 'video';
}

const pad = (n: number) => String(n).padStart(2, '0');
const stampOf = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const isUrl = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function createProject(dataDir: string, input: NewProjectInput, now: Date = new Date()): Promise<string> {
  // Folder name stays <= 48 chars even with a collision suffix: 26 + 1 + 15 + up to "-99999".
  const base = `${slugify(input.topic).slice(0, DIR_SLUG).replace(/-+$/g, '')}-${stampOf(now)}`;
  const projects = path.join(dataDir, 'projects');
  await fs.mkdir(projects, {recursive: true});
  let dir = '';
  for (let n = 1; ; n++) {
    dir = path.join(projects, n === 1 ? base : `${base}-${n}`);
    try {
      await fs.mkdir(dir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }

  const sources: string[] = [];
  const taken = new Set<string>();
  for (const src of input.sources) {
    if (isUrl(src) || !(await isFile(src))) {
      sources.push(src);
      continue;
    }
    let name = path.basename(src);
    if (taken.has(name.toLowerCase())) {
      const ext = path.extname(name);
      const stem = path.basename(name, ext);
      let i = 2;
      while (taken.has(`${stem}-${i}${ext}`.toLowerCase())) i++;
      name = `${stem}-${i}${ext}`;
    }
    taken.add(name.toLowerCase());
    await fs.mkdir(path.join(dir, 'sources', 'upload'), {recursive: true});
    await fs.copyFile(src, path.join(dir, 'sources', 'upload', name));
    sources.push(`sources/upload/${name}`);
  }

  const project: Project = {
    version: PROJECT_VERSION,
    brief: {
      topic: input.topic,
      language: input.language,
      targetMinutes: input.targetMinutes,
      style: input.style,
      provider: input.provider,
      webSearch: input.webSearch,
      sources,
    },
    sources: [],
    facts: [],
    scenes: [],
    voice: input.voice,
    progress: {done: []},
  };
  await saveProject(dir, project);
  return dir;
}
