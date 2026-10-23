import {z} from 'zod';
import {cueField, sharedFields} from './shared';

export const BarsSceneSchema = z.object({
  type: z.literal('bars'),
  ...sharedFields,
  bars: z
    .array(z.object({label: z.string().min(1).max(18), value: z.number().min(0), cue: cueField}))
    .min(2)
    .max(8),
  unit: z.string().min(1).max(8).optional(),
});
