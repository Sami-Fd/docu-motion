import {describe, expect, it} from 'vitest';
import {createFakeProvider} from '../../src/llm/fake.js';
import {createProvider, testConnection} from '../../src/llm/registry.js';
import {SettingsSchema} from '../../src/settings/settings.js';

const settings = SettingsSchema.parse({});

describe('createProvider', () => {
  it('returns a fake provider for kind fake', () => {
    expect(createProvider({kind: 'fake', provider: 'fake'}, settings).name.startsWith('fake')).toBe(true);
  });
  it('dispatches api providers', () => {
    expect(() => createProvider({kind: 'api', provider: 'anthropic'}, settings)).toThrow(/ANTHROPIC_API_KEY/);
  });
  it('cli arrives in Task 4', () => {
    expect(() => createProvider({kind: 'cli', provider: 'claude'}, settings)).toThrow('CLI providers arrive in Task 4');
  });
});

describe('testConnection', () => {
  it('reports ok with elapsed ms', async () => {
    const r = await testConnection(createFakeProvider(() => ({ok: true})));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ms).toBeGreaterThanOrEqual(0);
  });
  it('reports failure message', async () => {
    const r = await testConnection(createFakeProvider(() => ({ok: false})));
    expect(r.ok).toBe(false);
  });
});
