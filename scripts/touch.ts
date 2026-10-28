// Edits an existing project.
//   npm run touch -- <projectDir> regenerate <sceneId>
//   npm run touch -- <projectDir> edit <sceneId> "<text>"
//   npm run touch -- <projectDir> rerender
//   npm run touch -- <projectDir> prepare-recording
//   npm run touch -- <projectDir> recording <file> [--cuts t1,t2,...] [--noise <dB>] [--min-silence <s>]
//   npm run touch -- <projectDir> thumbnail <1|2|3>
//   npm run touch -- <projectDir> refresh-youtube [--youtube] [--thumbnails]
// Errors exit 1 (usage errors too, like make); Ctrl+C exits 130. Test hook DOCU_MOTION_FAKE_TTS=1: see scripts/cli-common.ts.
// Do not run touch and make on the same project at the same time: there is no project lock yet.
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  GenerateCancelled,
  ProjectLoadError,
  STEP_NAMES,
  StepFailedError,
  applyRecording,
  chooseThumbnail,
  createProvider,
  defaultDataDir,
  editNarration,
  formatWarningSummary,
  loadProject,
  loadSettings,
  prepareRecording,
  refreshYoutube,
  regenerateScene,
  rerender,
  type StepContext,
  type StepName,
} from '../packages/core/src/index.js';
import {fakeTtsSteps, reportPaths, usage} from './cli-common.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = [
  'Usage: npm run touch -- <projectDir> <command>',
  '  regenerate <sceneId>',
  '  edit <sceneId> "<text>"',
  '  rerender',
  '  prepare-recording',
  '  recording <file> [--cuts t1,t2,...] [--noise <dB>] [--min-silence <s>]',
  '  thumbnail <1|2|3>',
  '  refresh-youtube [--youtube] [--thumbnails]',
].join('\n');

const RERUN = 'run "rerender" to update the video';

/** Splits argv into positionals and the --name value / --flag options this command accepts. */
function parse(argv: string[], valued: string[], flags: string[] = []): {pos: string[]; opt: Record<string, string>; flag: Set<string>} {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  const flag = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (flags.includes(name)) flag.add(name);
    else if (valued.includes(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) usage(`--${name} needs a value\n${USAGE}`);
      opt[name] = v!;
    } else usage(`Unknown option ${a}\n${USAGE}`);
  }
  return {pos, opt, flag};
}

const num = (name: string, v: string): number => {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n)) usage(`Invalid --${name} "${v}": expected a number`);
  return n;
};

async function main(): Promise<number> {
  const envFile = path.join(REPO, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const [dirArg, command, ...rest] = process.argv.slice(2);
  if (!dirArg || !command) usage(USAGE);
  const projectDir = path.resolve(dirArg!);

  const controller = new AbortController();
  // once: a second Ctrl+C gets Node's default handler and force-quits.
  process.once('SIGINT', () => controller.abort());

  const context = async (): Promise<Omit<StepContext, 'projectDir'>> => {
    const settings = await loadSettings(path.resolve(defaultDataDir()), process.env);
    const p = await loadProject(projectDir);
    let lastStep: StepName | undefined;
    return {
      llm: createProvider(p.brief.provider, settings),
      settings,
      fetch,
      signal: controller.signal,
      onProgress: (e) => {
        if (e.step !== lastStep) {
          lastStep = e.step;
          console.error(`[${STEP_NAMES.indexOf(e.step) + 1}/${STEP_NAMES.length}] ${e.step} ...`);
        }
        if (e.log) console.error(`  ${e.log}`);
      },
    };
  };

  switch (command) {
    case 'regenerate': {
      const {pos} = parse(rest, []);
      if (pos.length !== 1) usage(USAGE);
      await regenerateScene(projectDir, pos[0]!, await context());
      console.log(`OK ${pos[0]} regenerated - ${RERUN}`);
      return 0;
    }
    case 'edit': {
      const {pos} = parse(rest, []);
      if (pos.length !== 2) usage(USAGE);
      await editNarration(projectDir, pos[0]!, pos[1]!);
      console.log(`OK ${pos[0]} narration updated - ${RERUN}`);
      return 0;
    }
    case 'rerender': {
      const {pos} = parse(rest, []);
      if (pos.length !== 0) usage(USAGE);
      let done;
      try {
        done = await rerender(projectDir, await context(), {steps: fakeTtsSteps()});
      } catch (e) {
        if (e instanceof StepFailedError) {
          console.error(`FAILED at ${e.step}: ${e.message}`);
          console.error('Run "rerender" again to continue');
          return 1;
        }
        throw e;
      }
      const summary = formatWarningSummary(done);
      if (summary) console.error(summary);
      console.log(`OK ${path.join(projectDir, 'out', 'video.mp4')}`);
      console.log(reportPaths(projectDir, done.thumbnail?.file).join('\n'));
      return 0;
    }
    case 'prepare-recording': {
      const {pos} = parse(rest, []);
      if (pos.length !== 0) usage(USAGE);
      const file = await prepareRecording(projectDir);
      console.log(`OK ${file} - read it aloud, leaving a 2 s pause at each <break>, then run "recording <file>"`);
      return 0;
    }
    case 'recording': {
      const {pos, opt} = parse(rest, ['cuts', 'noise', 'min-silence']);
      if (pos.length !== 1) usage(USAGE);
      const cuts = opt.cuts === undefined ? undefined : opt.cuts.split(',').map((t) => num('cuts', t));
      const r = await applyRecording(projectDir, path.resolve(pos[0]!), {
        cuts,
        noiseDb: opt.noise === undefined ? undefined : num('noise', opt.noise),
        minSilence: opt['min-silence'] === undefined ? undefined : num('min-silence', opt['min-silence']),
        signal: controller.signal,
      });
      if (!r.ok) {
        const list = r.silences.map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)} s`).join(', ') || 'none';
        console.error(`Found ${r.found} pauses, need ${r.needed}. Detected silences: ${list}`);
        console.error(`Pass --cuts with ${r.needed} times to override`);
        if (r.suggested.length > 0) console.error(`Try: --cuts ${r.suggested.map((t) => t.toFixed(2)).join(',')}`);
        if (r.hint) console.error(r.hint);
        return 1;
      }
      console.log(`OK recording split into ${r.project.scenes.length} scenes - ${RERUN}`);
      return 0;
    }
    case 'thumbnail': {
      const {pos} = parse(rest, []);
      if (pos.length !== 1) usage(USAGE);
      const n = Number(pos[0]);
      if (!Number.isInteger(n)) usage(`Invalid thumbnail "${pos[0]}": expected a number from 1`);
      await chooseThumbnail(projectDir, n - 1);
      console.log(`OK thumbnail ${n} chosen`);
      return 0;
    }
    case 'refresh-youtube': {
      const {pos, flag} = parse(rest, [], ['youtube', 'thumbnails']);
      if (pos.length !== 0) usage(USAGE);
      const both = flag.size === 0;
      await refreshYoutube(projectDir, {youtube: both || flag.has('youtube'), thumbnails: both || flag.has('thumbnails')});
      console.log('OK YouTube copy cleared - the next "rerender" regenerates it');
      return 0;
    }
    default:
      return usage(`Unknown command "${command}"\n${USAGE}`);
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof GenerateCancelled || (e instanceof Error && e.name === 'AbortError')) {
      console.error('Cancelled');
      process.exit(130);
    }
    if (e instanceof ProjectLoadError) {
      console.error(`${e.issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('\n')}\n${e.file}`);
      process.exit(1);
    }
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT' && String((e as Error).message).includes('project.json')) {
      console.error(`No project.json found in the given project directory`);
      process.exit(1);
    }
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
