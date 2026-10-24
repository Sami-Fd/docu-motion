import {execFileSync, spawn} from 'node:child_process';
import type {ProviderRef} from '../project/schema.js';
import {makeProvider} from './makeProvider.js';
import {ProviderError, type LlmProvider} from './types.js';

type CliName = 'claude' | 'codex' | 'gemini';

const FIXED_ARGS: Record<CliName, string[]> = {
  claude: ['-p', '--output-format', 'json'],
  codex: ['exec', '-'],
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
  if (!(cli in FIXED_ARGS)) throw new Error(`Unknown CLI provider "${ref.provider}"`);
  const name = `cli:${cli}`;
  const command = deps.command ?? cli;
  const args = deps.args ?? FIXED_ARGS[cli];
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
      const child = spawn(plan.file, plan.args, {
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
      child.on('error', (e: NodeJS.ErrnoException) =>
        finish(() => reject(e.code === 'ENOENT' ? notFound() : fail(e.message))),
      );
      child.on('close', (code) =>
        finish(() => {
          if (code === 0) return resolve(stdout);
          if (code === 9009 && plan.verbatim) return reject(notFound()); // cmd.exe: program not found
          // claude prints errors as JSON on stdout; stderr is often empty.
          const detail = (stderr.trim() || (cli === 'claude' ? claudeError(stdout) : undefined) || '').slice(-300);
          reject(fail(`${cli} exited with code ${code}${detail ? `: ${detail}` : ''}`));
        }),
      );
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
