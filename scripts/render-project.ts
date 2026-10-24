// Renders a project to <projectDir>/out/video.mp4 and probes the result.
//   npm run render -- <projectDir> [--style papier|craie|infographie|nuit]
// --style overrides the project style in memory only; project.json is never written.
import path from 'node:path';
import {ProjectLoadError, StyleNameSchema, loadProject} from '../packages/core/src/index.js';
import {renderVideo} from '../packages/core/src/render/render.js';
import {probeMedia} from '../packages/core/src/render/probe.js';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dirArg: string | undefined;
  let styleArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--style') {
      styleArg = args[++i];
      if (styleArg === undefined) fail('--style needs a value');
    } else if (a.startsWith('--style=')) {
      styleArg = a.slice('--style='.length);
    } else if (a.startsWith('--')) {
      fail(`Unknown option ${a}`);
    } else if (dirArg === undefined) {
      dirArg = a;
    } else {
      fail(`Unexpected argument ${a}`);
    }
  }
  if (!dirArg) fail('Usage: npm run render -- <projectDir> [--style papier|craie|infographie|nuit]');

  let style: ReturnType<typeof StyleNameSchema.parse> | undefined;
  if (styleArg !== undefined) {
    const parsed = StyleNameSchema.safeParse(styleArg);
    if (!parsed.success) {
      fail(`Unknown style "${styleArg}". Expected one of: ${StyleNameSchema.options.join(', ')}`);
    } else {
      style = parsed.data;
    }
  }

  const projectDir = path.resolve(dirArg!);
  let project;
  try {
    project = await loadProject(projectDir);
  } catch (e) {
    if (e instanceof ProjectLoadError) {
      const lines = e.issues.map((i) => `${i.path || '(root)'}: ${i.message}`);
      fail(`${lines.join('\n')}\n${e.file}`);
    }
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') fail(`No project.json found in ${projectDir}`);
    throw e;
  }
  if (style) project = {...project, brief: {...project.brief, style}};

  let lastPct = -1;
  const file = await renderVideo(projectDir, project, {
    onProgress: (r) => {
      const pct = Math.floor(r * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        console.error(`rendering ${pct}%`);
      }
    },
  });
  const info = await probeMedia(file);
  console.log(`OK ${file} ${info.durationSeconds.toFixed(1)}s audio=${info.hasAudio}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
