import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Run npx from the core package so it finds the workspace's local remotion CLI regardless of caller cwd.
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

export type ToolResult = {stdout: string; stderr: string};

/** Runs Remotion's bundled ffmpeg/ffprobe. stderr is collected in full (silencedetect output can be long). */
export function runRemotionTool(
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  opts: {signal?: AbortSignal} = {},
): Promise<ToolResult> {
  const win = process.platform === 'win32';
  // On Windows npx is a .cmd shim that needs a shell, so quote the arguments ourselves.
  const quote = (s: string) => (win ? `"${s}"` : s);
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['remotion', tool, ...args.map(quote)], {
      shell: win,
      windowsHide: true,
      cwd: PACKAGE_DIR,
      signal: opts.signal,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${tool} failed (exit ${code}): ${stderr.trim().slice(-500)}`));
      resolve({stdout, stderr});
    });
  });
}

export async function probeAudioSeconds(file: string): Promise<number> {
  const {stdout} = await runRemotionTool('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file]);
  let seconds = NaN;
  try {
    seconds = Number((JSON.parse(stdout) as {format?: {duration?: string}}).format?.duration);
  } catch {
    // fall through to the error below
  }
  if (!Number.isFinite(seconds)) throw new Error(`Could not read the audio duration of ${file}`);
  return seconds;
}

/** Cuts [start, end] seconds of `input` into a 16-bit PCM WAV. */
export async function cutAudio(input: string, start: number, end: number, output: string): Promise<void> {
  await runRemotionTool('ffmpeg', [
    '-y',
    '-i',
    input,
    '-ss',
    String(start),
    '-to',
    String(end),
    '-c:a',
    'pcm_s16le',
    output,
  ]);
}
