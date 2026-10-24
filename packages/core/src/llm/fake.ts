import type {ZodType} from 'zod';
import {makeProvider} from './makeProvider.js';
import type {LlmProvider} from './types.js';

export function createFakeProvider(
  responder: (req: {schema: ZodType; system: string; prompt: string}) => unknown | string,
  capabilities: LlmProvider['capabilities'] = {nativeWebSearch: false, vision: false},
): LlmProvider {
  // The raw layer has no Zod schema, so the responder gets it through this closure.
  let current: ZodType | undefined;
  const base = makeProvider(
    {
      name: 'fake:fake',
      capabilities,
      object: async ({system, prompt}) => responder({schema: current as ZodType, system, prompt}),
      text: async ({system, prompt}) => String(responder({schema: current as ZodType, system, prompt})),
    },
    {sleep: async () => {}},
  );
  return {
    ...base,
    generateObject: (args) => {
      current = args.schema;
      return base.generateObject(args);
    },
  };
}
