// Edits an existing project.
//   npm run touch -- <projectDir> regenerate <sceneId>
//   npm run touch -- <projectDir> edit <sceneId> "<text>"
//   npm run touch -- <projectDir> rerender
//   npm run touch -- <projectDir> prepare-recording
//   npm run touch -- <projectDir> recording <file> [--cuts t1,t2,...] [--noise <dB>] [--min-silence <s>]
//   npm run touch -- <projectDir> thumbnail <1|2|3>
//   npm run touch -- <projectDir> refresh-youtube [--youtube] [--thumbnails]
//   npm run touch -- <projectDir> voice <edge|elevenlabs|openai|none> [--voice-id <id>]
// Any command also takes --data <dir> (default: the folder above <dir>/../ when it is <data>/projects/<name>). Put -- before
// arguments that start with -- (edit s02 -- "--5 % de dette").
// Errors exit 1 (usage errors too, like make); Ctrl+C exits 130. Test hook DOCU_MOTION_FAKE_TTS=1: see scripts/cli-common.ts.
// Do not run touch and make on the same project at the same time: there is no project lock yet.
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  GenerateCancelled,
  ProjectLoadError,
  StepFailedError,
  applyRecording,
  chooseThumbnail,
  createProvider,
  createTtsEngine,
  editNarration,
  formatWarningSummary,
  loadProject,
  loadSettings,
  prepareRecording,
  refreshYoutube,
  regenerateScene,
  rerender,
  setVoice,
  type StepContext,
} from '../packages/core/src/index.js';
import {dataDirFor, fakeTtsEnabled, reportPaths, runCli, stepProgress, testTtsSteps, usage, voiceFailureHint} from './cli-common.js';

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
  '  voice <edge|elevenlabs|openai|none> [--voice-id <id>]',
  'Any command also takes --data <dir>; put -- before arguments that start with --.',
].join('\n');

/** Core words the threshold generically; the CLI names its option. */
const flagNames = (m: string) => m.replace(/noise threshold/g, '--noise threshold');

const RERUN = 'run "rerender" to update the video';

/** Splits argv into positionals and the --name value / --flag options this command accepts. */
function parse(argv: string[], valued: string[], flags: string[] = []): {pos: string[]; opt: Record<string, string>; flag: Set<string>} {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  const flag = new Set<string>();
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!literal && a === '--') {
      literal = true;
      continue;
    }
    if (literal || !a.startsWith('--')) {
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

/** Takes `--data <dir>` out of the arguments (before a `--` terminator). */
function takeData(argv: string[]): {rest: string[]; data?: string} {
  const rest: string[] = [];
  let data: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      rest.push(...argv.slice(i));
      break;
    }
    if (a === '--data') {
      data = argv[++i];
      if (!data) usage('--data needs a folder');
    } else if (a.startsWith('--data=')) data = a.slice(7);
    else rest.push(a);
  }
  return {rest, data};
}

async function main(): Promise<number> {
  const envFile = path.join(REPO, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const [dirArg, command, ...tail] = process.argv.slice(2);
  if (!dirArg || !command) usage(USAGE);
  const projectDir = path.resolve(dirArg!);
  const {rest, data} = takeData(tail);
  const {dataDir, isDefault} = dataDirFor(projectDir, data);
  if (!isDefault) console.error(`Settings: ${path.join(dataDir, 'config.json')}`);
  if (!existsSync(path.join(projectDir, 'project.json'))) {
    usage(`No project.json found in ${projectDir} (the project folder comes first: touch <projectDir> <command>)`);
  }

  const controller = new AbortController();
  // once: a second Ctrl+C gets Node's default handler and force-quits.
  process.once('SIGINT', () => controller.abort());

  const context = async (): Promise<Omit<StepContext, 'projectDir'>> => {
    const settings = await loadSettings(dataDir, process.env);
    const p = await loadProject(projectDir);
    return {
      llm: createProvider(p.brief.provider, settings),
      settings,
      fetch,
      signal: controller.signal,
      onProgress: stepProgress(),
    };
  };

  switch (command) {
    case 'regenerate': {
      const {pos} = parse(rest, []);
      if (pos.length !== 1) usage(USAGE);
      const id = pos[0]!.toLowerCase();
      await regenerateScene(projectDir, id, await context());
      console.log(`OK ${id} regenerated — ${RERUN}`);
      return 0;
    }
    case 'edit': {
      const {pos} = parse(rest, []);
      if (pos.length !== 2) usage(USAGE);
      const id = pos[0]!.toLowerCase();
      await editNarration(projectDir, id, pos[1]!);
      console.log(`OK ${id} narration updated — ${RERUN}`);
      return 0;
    }
    case 'rerender': {
      const {pos} = parse(rest, []);
      if (pos.length !== 0) usage(USAGE);
      let done;
      try {
        done = await rerender(projectDir, await context(), {steps: testTtsSteps()});
      } catch (e) {
        if (e instanceof StepFailedError) {
          console.error(`FAILED at ${e.step}: ${e.message}`);
          if (e.step === 'voice') console.error(voiceFailureHint(projectDir));
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
      console.log(`OK ${file} — read it aloud, leaving a 2 s pause at each <break>, then run "recording <file>"`);
      return 0;
    }
    case 'recording': {
      const {pos, opt} = parse(rest, ['cuts', 'noise', 'min-silence']);
      if (pos.length !== 1) usage(USAGE);
      const noiseDb = opt.noise === undefined ? undefined : num('noise', opt.noise);
      if (noiseDb !== undefined && noiseDb >= 0) usage(`Invalid --noise "${opt.noise}": expected a negative number of dB, such as -38`);
      const minSilence = opt['min-silence'] === undefined ? undefined : num('min-silence', opt['min-silence']);
      if (minSilence !== undefined && minSilence <= 0) usage(`Invalid --min-silence "${opt['min-silence']}": expected a number of seconds above 0`);
      const cuts = opt.cuts === undefined ? undefined : opt.cuts.split(',').map((t) => num('cuts', t));
      const r = await applyRecording(projectDir, path.resolve(pos[0]!), {cuts, noiseDb, minSilence, signal: controller.signal});
      if (!r.ok) {
        const list = r.silences.map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)} s`).join(', ') || 'none';
        console.error(`Found ${r.found} pauses, need ${r.needed}. Detected silences: ${list}`);
        console.error(`Pass --cuts with ${r.needed} times to override`);
        if (r.suggested.length > 0) console.error(`Try: --cuts ${r.suggested.map((t) => t.toFixed(2)).join(',')}`);
        if (r.hint) console.error(flagNames(r.hint));
        return 1;
      }
      console.log(`OK recording split into ${r.project.scenes.length} scenes — ${RERUN}`);
      return 0;
    }
    case 'thumbnail': {
      const {pos} = parse(rest, []);
      if (pos.length !== 1) usage(USAGE);
      const n = Number(pos[0]);
      if (!Number.isInteger(n)) usage(`Invalid thumbnail "${pos[0]}": expected a number from 1`);
      await chooseThumbnail(projectDir, n - 1, {signal: controller.signal});
      console.log(`OK thumbnail ${n} chosen`);
      return 0;
    }
    case 'refresh-youtube': {
      const {pos, flag} = parse(rest, [], ['youtube', 'thumbnails']);
      if (pos.length !== 0) usage(USAGE);
      const both = flag.size === 0;
      const youtube = both || flag.has('youtube');
      const thumbnails = both || flag.has('thumbnails');
      await refreshYoutube(projectDir, {youtube, thumbnails});
      const cleared = youtube && thumbnails ? 'YouTube copy and thumbnail options' : youtube ? 'YouTube copy' : 'thumbnail options';
      console.log(`OK ${cleared} cleared — the next "rerender" regenerates ${youtube && thumbnails ? 'them' : 'it'}`);
      return 0;
    }
    case 'voice': {
      const {pos, opt} = parse(rest, ['voice-id']);
      if (pos.length !== 1) usage(USAGE);
      const engine = pos[0] as 'edge' | 'elevenlabs' | 'openai' | 'none';
      if (!['edge', 'elevenlabs', 'openai', 'none'].includes(engine)) usage(`Unknown voice engine "${pos[0]}". Expected one of: edge, elevenlabs, openai, none`);
      if (opt['voice-id'] !== undefined && opt['voice-id'].trim() === '') usage('--voice-id is empty: give a voice id or leave the option out');
      // Same early key check as make: a missing key must fail now, not at the voice step.
      if ((engine === 'elevenlabs' || engine === 'openai') && !fakeTtsEnabled()) {
        createTtsEngine(engine, await loadSettings(dataDir, process.env));
      }
      await setVoice(projectDir, {engine, voiceId: opt['voice-id']});
      console.log(`OK voice set to ${engine}${opt['voice-id'] ? ` (${opt['voice-id']})` : ''} — ${RERUN}`);
      return 0;
    }
    default:
      return usage(`Unknown command "${command}"\n${USAGE}`);
  }
}

runCli(main, (e) => {
  if (e instanceof GenerateCancelled || (e instanceof Error && e.name === 'AbortError')) {
    console.error('Cancelled');
    return 130;
  }
  if (e instanceof ProjectLoadError) {
    console.error(`${e.issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('\n')}\n${e.file}`);
    return 1;
  }
  console.error(e instanceof Error ? flagNames(e.message) : String(e));
  return 1;
});
