import {z} from 'zod';
import {cueField, sharedFields} from './shared';

export const CounterSceneSchema = z.object({
  type: z.literal('counter'),
  ...sharedFields,
  value: z.number(),
  prefix: z.string().min(1).max(4).optional(),
  suffix: z.string().min(1).max(10).optional(),
  label: z.string().min(1).max(60),
  cue: cueField,
});
