import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const runTsx = (script: string, args: string[], env: Record<string, string> = {}): Promise<{code: number | null; stdout: string; stderr: string}> =>
  new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const quote = (s: string) => (win ? `"${s}"` : s);
    const child = spawn('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', script, ...args.map(quote)], {
      shell: win,
      windowsHide: true,
      cwd: REPO,
      env: {...process.env, ...env},
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({code, stdout, stderr}));
  });

let data: string;
beforeAll(async () => {
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'docu-motion-exit-'));
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify({search: 'off'}), 'utf8');
});
afterAll(async () => {
  await fs.rm(data, {recursive: true, force: true});
});

describe('a process never ends silently while work is pending', () => {
  it('a transient failure retried through the real backoff timer settles', async () => {
    const r = await runTsx('packages/core/test/render/fixtures/sleepProbe.ts', []);
    expect(r.stdout).toContain('REJECTED getaddrinfo EAI_AGAIN');
  }, 60_000);

  it('make with an unreachable Edge service fails with the all-scenes message and exit 1', async () => {
    const r = await runTsx('scripts/make.ts', ['La dette publique', '--provider', 'fake', '--data', data], {
      DOCU_MOTION_TTS_UNREACHABLE: '1',
      DOCU_MOTION_FAKE_TTS: '',
    });
    expect(r.stderr).toContain('FAILED at voice: Voice engine "edge" failed for every scene');
    expect(r.stderr).toContain('EAI_AGAIN');
    expect(r.stderr).toContain('touch');
    expect(r.code).toBe(1);
  }, 300_000);
});
