import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {ProviderRef} from '../project/schema.js';
import {APP_KEY_ENV_VARS} from '../settings/settings.js';
import {makeProvider} from './makeProvider.js';
import {ProviderError, type LlmProvider} from './types.js';

type CliName = 'claude' | 'codex' | 'gemini';

/**
 * Constant arguments. Prompts contain untrusted web text, so the CLIs run with as few powers as their
 * documented flags allow, always in a fresh empty temp dir (never the repo, which holds data/config.json):
 * - claude: one turn, built-in file/shell/web tools disallowed.
 * - codex: read-only sandbox; --skip-git-repo-check because the temp dir is not a git repo.
 * - gemini: no extra flags (its non-interactive mode already refuses tools that need approval);
 *   cwd isolation is the only measure.
 * Every argument must stay free of spaces and cmd.exe metacharacters (see planSpawn).
 */
export const CLI_ARGS: Record<CliName, readonly string[]> = {
  claude: [
    '-p',
    '--output-format',
    'json',
    '--max-turns',
    '1',
    '--disallowedTools',
    'Bash',
    'Read',
    'Write',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
    'Glob',
    'Grep',
    'LS',
    'WebFetch',
    'WebSearch',
    'Task',
  ],
  codex: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'],
  gemini: ['-p'],
};

const TIMEOUT_MS = 300_000;
const MAX_STDOUT_BYTES = 20 * 1024 * 1024;
const MAX_STDERR_CHARS = 64 * 1024;

export type CliDeps = {command?: string; args?: string[]; timeoutMs?: number; maxStdoutBytes?: number};

export type Spawnable = {file: string; args: string[]; verbatim: boolean};

function whereOutput(command: string): string {
  try {
    return execFileSync('where', [command], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  } catch {
    return '';
  }
}

/**
 * Pure planning of the spawn. Windows: npm installs CLIs as .cmd shims, which Node refuses to
 * spawn without a shell (EINVAL, CVE-2024-27980). We never use `shell: true`. `whereOut` is the
 * output of `where <command>`: prefer `.exe`, then `.cmd`/`.bat` (run through `cmd.exe /d /s /c`
 * with a fixed command line); everything else (extensionless sh shims, .ps1) is ignored.
 * Only the resolved path and constant args reach the command line; the prompt goes on stdin.
 * Returns undefined when nothing spawnable was found or the path is unsafe for cmd.exe.
 */
export function planSpawn(
  whereOut: string,
  platform: NodeJS.Platform,
  command: string,
  args: string[],
  comSpec = 'cmd.exe',
): Spawnable | undefined {
  if (platform !== 'win32') return {file: command, args, verbatim: false};
  const found = whereOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const exe = found.find((f) => /\.exe$/i.test(f));
  if (exe) return {file: exe, args, verbatim: false};
  const shim = found.find((f) => /\.(cmd|bat)$/i.test(f));
  if (!shim) return undefined;
  if (/["%^&|<>\r\n]/.test(shim)) return undefined; // refuse paths cmd.exe could misparse
  return {file: comSpec, args: ['/d', '/s', '/c', `""${shim}" ${args.join(' ')}"`], verbatim: true};
}

/**
 * The child env: ours minus the app's own API keys (an agentic CLI must not inherit them; the CLIs keep
 * their own credentials such as GEMINI_API_KEY or the ~/.claude login). Windows env names are
 * case-insensitive, so strip them case-insensitively there.
 */
export function childEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const strip = new Set(platform === 'win32' ? APP_KEY_ENV_VARS.map((k) => k.toUpperCase()) : APP_KEY_ENV_VARS);
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (!strip.has(platform === 'win32' ? k.toUpperCase() : k)) out[k] = v;
  }
  return out;
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
      return;
    } catch {
      // fall through to a plain kill
    }
  }
  child.kill();
}

function claudeError(stdout: string): string | undefined {
  try {
    const j = JSON.parse(stdout) as {result?: unknown; is_error?: unknown; subtype?: unknown} | null;
    if (j && (j.is_error === true || (typeof j.subtype === 'string' && j.subtype.startsWith('error')))) {
      return typeof j.result === 'string' && j.result ? j.result : String(j.subtype ?? 'error');
    }
  } catch {
    // not JSON
  }
  return undefined;
}

export function createCliProvider(ref: ProviderRef, deps: CliDeps = {}): LlmProvider {
  const cli = ref.provider as CliName;
  if (!(cli in CLI_ARGS)) throw new Error(`Unknown CLI provider "${ref.provider}"`);
  const name = `cli:${cli}`;
  const command = deps.command ?? cli;
  const args = deps.args ?? [...CLI_ARGS[cli]];
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const maxStdout = deps.maxStdoutBytes ?? MAX_STDOUT_BYTES;
  const notFound = () =>
    new ProviderError(`${cli} not found — install it and sign in, see README`, {provider: name, transient: false});
  const fail = (message: string) => new ProviderError(message, {provider: name, transient: false});

  const abortError = () => {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    return e;
  };

  function run(input: string, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const plan =
        deps.command !== undefined || process.platform !== 'win32'
          ? planSpawn('', 'linux', command, args)
          : planSpawn(whereOutput(command), process.platform, command, args, process.env.ComSpec);
      if (!plan) return reject(notFound());
      // Fresh empty working dir: an agentic CLI must not see the repo (keys in data/config.json).
      const cwd = mkdtempSync(path.join(os.tmpdir(), 'docu-motion-cli-'));
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        try {
          rmSync(cwd, {recursive: true, force: true, maxRetries: 3});
        } catch {
          // best effort: a killed process may still hold the dir on Windows
        }
      };
      const child = spawn(plan.file, plan.args, {
        cwd,
        env: childEnv(process.env),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: plan.verbatim,
      });
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () => {
        killTree(child);
        finish(() => reject(abortError()));
      };
      // A timeout is not transient: retrying a 300 s hang three times would block for 15+ minutes.
      const timer = setTimeout(() => {
        killTree(child);
        finish(() => reject(fail(`${cli} timed out after ${Math.round(timeoutMs / 1000)} s`)));
      }, timeoutMs);
      timer.unref();
      signal?.addEventListener('abort', onAbort, {once: true});

      child.stdout.setEncoding('utf8').on('data', (c: string) => {
        stdoutBytes += Buffer.byteLength(c);
        if (stdoutBytes > maxStdout) {
          killTree(child);
          finish(() => reject(fail(`${cli} produced more than ${Math.round(maxStdout / 1048576)} MB of output`)));
          return;
        }
        stdout += c;
      });
      child.stderr.setEncoding('utf8').on('data', (c: string) => {
        stderr = (stderr + c).slice(-MAX_STDERR_CHARS);
      });
      child.on('error', (e: NodeJS.ErrnoException) => {
        cleanup();
        finish(() => reject(e.code === 'ENOENT' ? notFound() : fail(e.message)));
      });
      child.on('close', (code) => {
        cleanup();
        finish(() => {
          if (code === 0) return resolve(stdout);
          if (code === 9009 && plan.verbatim) return reject(notFound()); // cmd.exe: program not found
          // claude prints errors as JSON on stdout; stderr is often empty.
          const detail = (stderr.trim() || (cli === 'claude' ? claudeError(stdout) : undefined) || '').slice(-300);
          reject(fail(`${cli} exited with code ${code}${detail ? `: ${detail}` : ''}`));
        });
      });
      child.stdin.on('error', () => {}); // EPIPE if the CLI exits before reading
      child.stdin.end(input);
    });
  }

  function parseOutput(stdout: string): string {
    if (cli !== 'claude') return stdout;
    const err = claudeError(stdout);
    if (err !== undefined) throw fail(`claude reported an error: ${err.slice(-300)}`);
    try {
      const j = JSON.parse(stdout) as {result?: unknown} | null;
      if (j && typeof j.result === 'string') return j.result;
    } catch {
      // not JSON: use the raw text
    }
    return stdout;
  }

  return makeProvider({
    name,
    capabilities: {nativeWebSearch: false, vision: false},
    async object({jsonSchema, system, prompt, signal}) {
      const full = `${system}\n\n${prompt}\n\nReply with only JSON matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
      return parseOutput(await run(full, signal));
    },
    async text({system, prompt, signal}) {
      return parseOutput(await run(`${system}\n\n${prompt}`, signal)).trim();
    },
  });
}
