import {z} from 'zod';
import {cueField, sharedFields} from './shared';

export const PictogramsSceneSchema = z.object({
  type: z.literal('pictograms'),
  ...sharedFields,
  groups: z
    .array(
      z.object({
        label: z.string().min(1).max(24),
        count: z.number().int().min(1).max(12),
        elderly: z.boolean(),
        ratio: z.string().min(1).max(8).optional(),
        cue: cueField,
      }),
    )
    .min(1)
    .max(2),
});
