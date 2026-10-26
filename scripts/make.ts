// Generates a video from a topic.
//   npm run make -- "<topic>" [--style papier|craie|infographie|nuit] [--sources <url|file>...] [--length <min>]
//     [--language <code>] [--provider <name>] [--model <id>] [--voice none] [--data <dir>] [--resume <projectDir>] [--check]
// Test-only hooks (never set outside tests): DOCU_MOTION_FAIL_AT=<step> makes that step throw (read only here);
// DOCU_MOTION_FAKE_LOG=<file> makes the fake provider log its calls (read only by demoResponder);
// DOCU_MOTION_FAKE_TTS=1 makes the voice step use the offline 440 Hz tone engine (words / 2.5 s) instead of a real TTS (read only here, injected into voiceStep).
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  GenerateCancelled,
  ProjectLoadError,
  STEP_NAMES,
  StepFailedError,
  StyleNameSchema,
  createProject,
  createFakeTtsEngine,
  createProvider,
  defaultDataDir,
  explainWebSearch,
  formatWarningSummary,
  generate,
  loadProject,
  loadSettings,
  nativeSearchFor,
  requireProvider,
  redact,
  testConnection,
  voiceStep,
  type ProviderRef,
  type Step,
  type StepName,
} from '../packages/core/src/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE =
  'Usage: npm run make -- "<topic>" [--style papier|craie|infographie|nuit] [--sources <url|file>...] [--length <min>] ' +
  '[--language <code>] [--provider <name>] [--model <id>] [--voice none] [--data <dir>] [--resume <projectDir>] [--check]';

class UsageError extends Error {}
const usage = (message: string): never => {
  throw new UsageError(message);
};

const CLI_PROVIDERS = ['claude', 'codex', 'gemini'];
const API_PROVIDERS = ['anthropic', 'openai', 'google', 'mistral', 'openrouter', 'ollama'];

function providerRefFor(name: string, model?: string): ProviderRef {
  const m = model ? {model} : {};
  if (name === 'fake') return {kind: 'fake', provider: 'fake', ...m};
  if (CLI_PROVIDERS.includes(name)) return {kind: 'cli', provider: name, ...m};
  if (API_PROVIDERS.includes(name)) return {kind: 'api', provider: name, ...m};
  return usage(`Unknown provider "${name}". Expected one of: fake, ${[...CLI_PROVIDERS, ...API_PROVIDERS].join(', ')}`);
}

type Args = {
  topic?: string;
  style?: string;
  sources: string[];
  length?: string;
  language?: string;
  provider?: string;
  model?: string;
  voice?: string;
  data?: string;
  resume?: string;
  check: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {sources: [], check: false};
  const single = new Set(['style', 'length', 'language', 'provider', 'model', 'voice', 'data', 'resume']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      if (out.topic !== undefined) usage(`Unexpected argument ${a}`);
      out.topic = a;
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    if (name === 'check') {
      out.check = true;
    } else if (name === 'sources') {
      if (inline !== undefined) out.sources.push(inline);
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) out.sources.push(argv[++i]!);
      if (out.sources.length === 0) usage('--sources needs at least one URL or file');
    } else if (single.has(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined) usage(`--${name} needs a value`);
      (out as Record<string, unknown>)[name] = v;
    } else {
      usage(`Unknown option ${a}`);
    }
  }
  return out;
}

/** A source must be an http(s) URL or an existing file: a typo must not silently become a knowledge-only video. */
function checkSource(s: string): void {
  if (/^https?:\/\//i.test(s)) {
    try {
      new URL(s);
      return;
    } catch {
      usage(`Invalid source URL "${s}"`);
    }
  }
  let isFile = false;
  try {
    isFile = statSync(s).isFile();
  } catch {
    // missing
  }
  if (!isFile) usage(`Source not found: "${s}" — expected an http(s) URL or an existing file`);
}

async function main(): Promise<number> {
  const envFile = path.join(REPO, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const args = parseArgs(process.argv.slice(2));
  if (args.resume !== undefined && args.topic !== undefined) usage('Give either a topic or --resume <projectDir>, not both');
  if (args.resume === undefined && !args.check && args.topic === undefined) usage(USAGE);

  let style: ReturnType<typeof StyleNameSchema.parse> | undefined;
  if (args.style !== undefined) {
    const parsed = StyleNameSchema.safeParse(args.style);
    if (!parsed.success) usage(`Unknown style "${args.style}". Expected one of: ${StyleNameSchema.options.join(', ')}`);
    else style = parsed.data;
  }
  let minutes = 3;
  if (args.length !== undefined) {
    minutes = Number(args.length);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10) usage(`Invalid --length "${args.length}": expected a number of minutes between 1 and 10`);
  }
  if (args.voice !== undefined && args.voice !== 'none') usage(`Voice engine "${args.voice}" arrives in Plan 3; use --voice none`);
  if (args.resume !== undefined && args.sources.length > 0) usage('--sources cannot be combined with --resume');
  for (const s of args.sources) checkSource(s);
  const explicitRef = args.provider !== undefined ? providerRefFor(args.provider, args.model) : undefined;

  const dataDir = path.resolve(args.data ?? defaultDataDir());
  const settings = await loadSettings(dataDir, process.env);
  const withModel = (r: ProviderRef): ProviderRef => (args.model ? {...r, model: args.model} : r);

  if (args.check) {
    const ref = explicitRef ?? withModel(requireProvider(settings));
    const result = await testConnection(createProvider(ref, settings));
    if (result.ok) {
      console.log(`OK ${ref.provider} ${result.ms}ms`);
      return 0;
    }
    const secrets = Object.values(settings.keys).filter((v): v is string => typeof v === 'string' && v.length > 0);
    console.error(redact(result.message, secrets));
    return 1;
  }

  let ref: ProviderRef;
  let resumed: {dir: string; webSearch: string} | undefined;
  if (args.resume !== undefined) {
    const dir = path.resolve(args.resume);
    try {
      const existing = await loadProject(dir);
      ref = existing.brief.provider;
      resumed = {dir, webSearch: existing.brief.webSearch};
    } catch (e) {
      if (e instanceof ProjectLoadError) {
        usage(`${e.issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('\n')}\n${e.file}`);
      }
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') usage(`No project.json found in ${dir}`);
      throw e;
    }
  } else {
    ref = explicitRef ?? withModel(requireProvider(settings));
  }

  // Build the provider before creating anything on disk: a missing key must not leave an orphan project.
  const llm = createProvider(ref, settings);

  let projectDir: string;
  let webSearch: string;
  if (resumed) {
    ({dir: projectDir, webSearch} = resumed);
    console.error(`Web search: ${webSearch}`);
  } else {
    const {mode: search, reason} = explainWebSearch(settings, ref, args.sources.length > 0);
    webSearch = search;
    console.error(`Web search: ${search}${reason ? ` (${reason})` : ''}`);
    projectDir = await createProject(dataDir, {
      topic: args.topic!,
      style: style ?? 'papier',
      language: args.language ?? settings.defaultLanguage,
      targetMinutes: minutes,
      provider: ref,
      webSearch: search,
      sources: args.sources,
      voice: {engine: 'none'},
    });
    console.error(`Project: ${projectDir}`);
  }

  const resumeHint = `npm run make -- --resume "${projectDir}"`;
  const controller = new AbortController();
  // once: a second Ctrl+C gets Node's default handler and force-quits.
  process.once('SIGINT', () => controller.abort());

  const failAt = process.env.DOCU_MOTION_FAIL_AT;
  const steps: Partial<Record<StepName, Step>> = {};
  if (failAt && (STEP_NAMES as readonly string[]).includes(failAt)) {
    steps[failAt as StepName] = async () => {
      throw new Error(`Injected failure (DOCU_MOTION_FAIL_AT=${failAt})`);
    };
  }

  if (process.env.DOCU_MOTION_FAKE_TTS === '1') steps.voice = voiceStep({engine: createFakeTtsEngine()});

  let lastStep: StepName | undefined;
  let done: Awaited<ReturnType<typeof generate>>;
  try {
    done = await generate(
      projectDir,
      {
        llm,
        settings,
        fetch,
        signal: controller.signal,
        nativeSearch: webSearch === 'native' ? nativeSearchFor(ref, settings) : undefined,
        onProgress: (e) => {
          if (e.step !== lastStep) {
            lastStep = e.step;
            console.error(`[${STEP_NAMES.indexOf(e.step) + 1}/${STEP_NAMES.length}] ${e.step} …`);
          }
          if (e.log) console.error(`  ${e.log}`);
        },
      },
      {steps},
    );
  } catch (e) {
    if (e instanceof GenerateCancelled) {
      console.error(`Cancelled — resume with ${resumeHint}`);
      return 130;
    }
    if (e instanceof StepFailedError) {
      console.error(`FAILED at ${e.step}: ${e.message}`);
      console.error(`Resume with: ${resumeHint}`);
      return 1;
    }
    throw e;
  }
  const summary = formatWarningSummary(done);
  if (summary) console.error(summary);
  console.log(`OK ${path.join(projectDir, 'out', 'video.mp4')}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
