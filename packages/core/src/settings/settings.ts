import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {ProviderRefSchema} from '../project/schema.js';

const opt = z.string().optional();

export const SettingsSchema = z.object({
  provider: ProviderRefSchema.default({kind: 'fake', provider: 'fake'}),
  keys: z
    .object({
      anthropic: opt,
      openai: opt,
      google: opt,
      mistral: opt,
      openrouter: opt,
      tavily: opt,
      brave: opt,
      elevenlabs: opt,
    })
    .default({}),
  ollamaBaseUrl: z.string().default('http://localhost:11434/v1'),
  defaultLanguage: z.string().default('fr'),
  search: z.enum(['auto', 'native', 'tavily', 'brave', 'off']).default('auto'),
});
export type Settings = z.infer<typeof SettingsSchema>;

const ENV_KEYS: Record<string, keyof Settings['keys']> = {
  ANTHROPIC_API_KEY: 'anthropic',
  OPENAI_API_KEY: 'openai',
  GOOGLE_GENERATIVE_AI_API_KEY: 'google',
  MISTRAL_API_KEY: 'mistral',
  OPENROUTER_API_KEY: 'openrouter',
  TAVILY_API_KEY: 'tavily',
  BRAVE_API_KEY: 'brave',
};

export function defaultDataDir(): string {
  if (process.env.DOCU_MOTION_DATA) return process.env.DOCU_MOTION_DATA;
  // this file: <repo>/packages/core/src/settings/settings.ts
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..', 'data');
}

/** Reads <dataDir>/config.json if present; env vars override. Does not load .env files. */
export async function loadSettings(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<Settings> {
  let fileData: unknown = {};
  try {
    fileData = JSON.parse(await readFile(path.join(dataDir, 'config.json'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const s = SettingsSchema.parse(fileData);
  for (const [envName, key] of Object.entries(ENV_KEYS)) {
    const v = env[envName];
    if (v) s.keys[key] = v;
  }
  if (env.OLLAMA_BASE_URL) s.ollamaBaseUrl = env.OLLAMA_BASE_URL;
  return s;
}

export async function saveSettings(dataDir: string, s: Settings): Promise<void> {
  await mkdir(dataDir, {recursive: true});
  await writeFile(path.join(dataDir, 'config.json'), JSON.stringify(s, null, 2) + '\n', 'utf8');
}
