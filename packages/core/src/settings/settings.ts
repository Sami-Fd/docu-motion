import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {ProviderRefSchema, type ProviderRef} from '../project/schema.js';

const opt = z.string().optional();

export const SettingsSchema = z.object({
  provider: ProviderRefSchema.optional(),
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

export function requireProvider(s: Settings): ProviderRef {
  if (!s.provider) {
    throw new Error('No AI provider configured — choose one in Settings (config.json) or pass --provider');
  }
  return s.provider;
}

export function defaultDataDir(): string {
  if (process.env.DOCU_MOTION_DATA) return process.env.DOCU_MOTION_DATA;
  // this file: <repo>/packages/core/src/settings/settings.ts
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..', 'data');
}

async function readConfigFile(dataDir: string): Promise<Settings> {
  const file = path.join(dataDir, 'config.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return SettingsSchema.parse({});
    throw new Error(`Cannot read settings file ${file}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid settings file ${file}: not valid JSON`);
  }
  const parsed = SettingsSchema.safeParse(data);
  if (!parsed.success) throw new Error(`Invalid settings file ${file}: does not match the settings format`);
  return parsed.data;
}

/** Reads <dataDir>/config.json if present; env vars override. Does not load .env files. */
export async function loadSettings(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<Settings> {
  const s = await readConfigFile(dataDir);
  for (const [envName, key] of Object.entries(ENV_KEYS)) {
    const v = env[envName];
    if (v) s.keys[key] = v;
  }
  if (env.OLLAMA_BASE_URL) s.ollamaBaseUrl = env.OLLAMA_BASE_URL;
  return s;
}

/** Writes config.json. Values that came from env vars are never persisted: the file's own value is kept instead. */
export async function saveSettings(dataDir: string, s: Settings, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const onDisk = await readConfigFile(dataDir);
  const out: Settings = {...s, keys: {...s.keys}};
  for (const [envName, key] of Object.entries(ENV_KEYS)) {
    if (env[envName]) {
      if (onDisk.keys[key] === undefined) delete out.keys[key];
      else out.keys[key] = onDisk.keys[key];
    }
  }
  if (env.OLLAMA_BASE_URL) out.ollamaBaseUrl = onDisk.ollamaBaseUrl;
  await mkdir(dataDir, {recursive: true});
  const file = path.join(dataDir, 'config.json');
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(out, null, 2) + '\n', {encoding: 'utf8', mode: 0o600});
  await rename(tmp, file);
}
