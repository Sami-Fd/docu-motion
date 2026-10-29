// Spawned by cliExit.e2e.test.ts: a transient failure retried through the REAL backoff timer must settle, not end the process.
import {withTransientRetry} from '../../../src/llm/makeProvider.js';
import {ProviderError} from '../../../src/llm/types.js';

withTransientRetry(async () => {
  throw new ProviderError('getaddrinfo EAI_AGAIN', {provider: 'edge', transient: true});
}).then(
  () => console.log('RESOLVED'),
  (e) => console.log(`REJECTED ${e instanceof Error ? e.message : String(e)}`),
);
