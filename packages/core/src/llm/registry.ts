import {z} from 'zod';
import type {ProviderRef} from '../project/schema.js';
import type {Settings} from '../settings/settings.js';
import {createApiProvider} from './aiSdk.js';
import {createCliProvider} from './cli.js';
import {demoResponder} from './demoResponder.js';
import {createFakeProvider} from './fake.js';
import type {LlmProvider} from './types.js';

export function createProvider(ref: ProviderRef, settings: Settings): LlmProvider {
  switch (ref.kind) {
    case 'api':
      return createApiProvider(ref, settings);
    case 'cli':
      return createCliProvider(ref);
    case 'fake':
      return createFakeProvider(demoResponder);
  }
}

export async function testConnection(
  p: LlmProvider,
): Promise<{ok: true; ms: number} | {ok: false; message: string}> {
  const start = Date.now();
  try {
    await p.generateObject({
      schema: z.object({ok: z.literal(true)}),
      system: 'You are a connection test. Reply with JSON only.',
      prompt: 'Return {"ok": true}',
    });
    return {ok: true, ms: Date.now() - start};
  } catch (e) {
    return {ok: false, message: e instanceof Error ? e.message : String(e)};
  }
}
