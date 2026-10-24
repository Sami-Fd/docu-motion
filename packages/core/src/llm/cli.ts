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

export type CliDeps = {command?: string; args?: string[]; timeoutMs?: number};

/**
 * Windows: npm installs CLIs as .cmd shims, which Node refuses to spawn without a shell
 * (EINVAL, CVE-2024-27980). We never use `shell: true`. We resolve the shim with `where`
 * and run it through `cmd.exe /d /s /c` with a fixed, quoted command line. Only the
 * resolved path and constant args reach the command line; the prompt goes on stdin.
 */
function resolveWindows(command: string): string | undefined {
  try {
    const out = execFileSync('where', [command], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
    const found = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // Prefer a real executable over a shim when both exist.
    return found.find((f) => /\.exe$/i.test(f)) ?? found[0];
  } catch {
    return undefined;
  }
}

type Spawnable = {file: string; args: string[]; verbatim: boolean};

function planSpawn(command: string, args: string[], injected: boolean): Spawnable | undefined {
  if (injected || process.platform !== 'win32') return {file: command, args, verbatim: false};
  const resolved = resolveWindows(command);
  if (!resolved) return undefined;
  if (/\.(cmd|bat)$/i.test(resolved)) {
    if (/["%^&|<>\r\n]/.test(resolved)) return undefined; // refuse paths cmd.exe could misparse
    const line = `"${resolved}" ${args.join(' ')}`;
    return {file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true};
  }
  return {file: resolved, args, verbatim: false};
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

export function createCliProvider(ref: ProviderRef, deps: CliDeps = {}): LlmProvider {
  const cli = ref.provider as CliName;
  if (!(cli in FIXED_ARGS)) throw new Error(`Unknown CLI provider "${ref.provider}"`);
  const name = `cli:${cli}`;
  const command = deps.command ?? cli;
  const args = deps.args ?? FIXED_ARGS[cli];
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const notFound = () =>
    new ProviderError(`${cli} not found — install it and sign in, see README`, {provider: name, transient: false});

  const abortError = () => {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    return e;
  };

  function run(input: string, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const plan = planSpawn(command, args, deps.command !== undefined);
      if (!plan) return reject(notFound());
      const child = spawn(plan.file, plan.args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: plan.verbatim,
      });
      let stdout = '';
      let stderr = '';
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
      const timer = setTimeout(() => {
        killTree(child);
        finish(() => reject(new ProviderError(`${cli} timed out after ${Math.round(timeoutMs / 1000)}s`, {provider: name, transient: true})));
      }, timeoutMs);
      timer.unref();
      signal?.addEventListener('abort', onAbort, {once: true});

      child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
      child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
      child.on('error', (e: NodeJS.ErrnoException) =>
        finish(() => reject(e.code === 'ENOENT' ? notFound() : new ProviderError(e.message, {provider: name, transient: false}))),
      );
      child.on('close', (code) =>
        finish(() => {
          if (code === 0) return resolve(stdout);
          // cmd.exe reports a missing program with exit code 1 / 9009.
          const tail = stderr.trim().slice(-300);
          reject(new ProviderError(`${cli} exited with code ${code}${tail ? `: ${tail}` : ''}`, {provider: name, transient: false}));
        }),
      );
      child.stdin.on('error', () => {}); // EPIPE if the CLI exits before reading
      child.stdin.end(input);
    });
  }

  function parseOutput(stdout: string): string {
    if (cli !== 'claude') return stdout;
    try {
      const j = JSON.parse(stdout) as {result?: unknown};
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
