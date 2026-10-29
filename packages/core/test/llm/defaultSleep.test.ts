import {describe, expect, it} from 'vitest';
import {defaultSleep} from '../../src/llm/makeProvider.js';

describe('defaultSleep', () => {
  it('resolves after the delay', async () => {
    const t = Date.now();
    await defaultSleep(60);
    expect(Date.now() - t).toBeGreaterThanOrEqual(50);
  });

  it('is released at once by an abort, so Ctrl+C is not delayed by a backoff', async () => {
    const ac = new AbortController();
    const t = Date.now();
    setTimeout(() => ac.abort(), 20);
    await defaultSleep(30_000, ac.signal);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
