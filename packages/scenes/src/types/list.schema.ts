import {z} from 'zod';
import {cueField, sharedFields} from './shared';

export const ListSceneSchema = z.object({
  type: z.literal('list'),
  ...sharedFields,
  items: z
    .array(
      z.object({
        text: z.string().min(1).max(60),
        icon: z.enum(['coin', 'drop', 'sun', 'cloud', 'character', 'none']),
        cue: cueField,
      }),
    )
    .min(2)
    .max(5),
});
