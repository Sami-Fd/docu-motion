import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {dataDirFor, stepProgress} from '../../../../scripts/cli-common.js';

const DEFAULT = path.resolve('/home/u/docu-motion/data');
const env = (configs: string[], platform: NodeJS.Platform = 'linux') => ({
  platform,
  defaultDir: DEFAULT,
  hasConfig: (dir: string) => configs.map((c) => path.resolve(c)).includes(path.resolve(dir)),
});

describe('dataDirFor', () => {
  it('uses --data first', () => {
    expect(dataDirFor('/a/projects/p', '/b', env([]))).toEqual({dataDir: path.resolve('/b'), isDefault: false});
  });
  it('trusts <data>/projects/<name> when <data> has a config.json', () => {
    expect(dataDirFor('/a/data/projects/p', undefined, env(['/a/data']))).toEqual({dataDir: path.resolve('/a/data'), isDefault: false});
  });
  it('falls back to the default dir when the parent has no config.json', () => {
    expect(dataDirFor('/a/data/projects/p', undefined, env([]))).toEqual({dataDir: DEFAULT, isDefault: true});
  });
  it('trusts the parent without a config.json when it is the default dir', () => {
    expect(dataDirFor(`${DEFAULT}/projects/p`, undefined, env([]))).toEqual({dataDir: DEFAULT, isDefault: true});
  });
  it('falls back for a project outside any projects folder', () => {
    expect(dataDirFor('/a/other/p', undefined, env(['/a']))).toEqual({dataDir: DEFAULT, isDefault: true});
  });
  it('compares the projects folder case-insensitively on win32 only', () => {
    expect(dataDirFor('/a/data/Projects/p', undefined, env(['/a/data'], 'win32')).dataDir).toBe(path.resolve('/a/data'));
    expect(dataDirFor('/a/data/Projects/p', undefined, env(['/a/data'], 'linux')).dataDir).toBe(DEFAULT);
  });
});

describe('stepProgress', () => {
  it('prints one numbered line per step, with "…", then the log lines', () => {
    const lines: string[] = [];
    const on = stepProgress((l) => lines.push(l));
    on({step: 'voice', ratio: 0.5});
    on({step: 'voice', log: 'hello'});
    on({step: 'render', ratio: 0});
    expect(lines).toEqual(['[5/8] voice …', '  hello', '[7/8] render …']);
  });
});
