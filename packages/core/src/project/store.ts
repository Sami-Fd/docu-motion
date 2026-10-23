import {promises as fs} from 'node:fs';
import path from 'node:path';
import {ProjectSchema, PROJECT_VERSION, type Project} from './schema.js';

export {PROJECT_VERSION};

export type ProjectIssue = {path: string; message: string};

export class ProjectLoadError extends Error {
  file: string;
  issues: ProjectIssue[];
  constructor(file: string, issues: ProjectIssue[]) {
    const detail = issues.map((i) => `  - ${i.path || '(root)'}: ${i.message}`).join('\n');
    super(`Invalid project file ${file}:\n${detail}`);
    this.name = 'ProjectLoadError';
    this.file = file;
    this.issues = issues;
  }
}

const fileOf = (dir: string) => path.join(dir, 'project.json');

export async function loadProject(dir: string): Promise<Project> {
  const file = fileOf(dir);
  const raw = await fs.readFile(file, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new ProjectLoadError(file, [{path: '', message: `Not valid JSON: ${(e as Error).message}`}]);
  }
  const result = ProjectSchema.safeParse(json);
  if (!result.success) {
    throw new ProjectLoadError(
      file,
      result.error.issues.map((i) => ({path: i.path.join('.'), message: i.message})),
    );
  }
  return result.data;
}

export async function saveProject(dir: string, p: Project): Promise<void> {
  const file = fileOf(dir);
  await fs.mkdir(dir, {recursive: true});
  try {
    await fs.copyFile(file, file + '.bak');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(p, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}
