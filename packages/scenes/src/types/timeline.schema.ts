import {z} from 'zod';
import {cueField, sharedFields} from './shared';

export const TimelineSceneSchema = z.object({
  type: z.literal('timeline'),
  ...sharedFields,
  events: z
    .array(z.object({date: z.string().min(1).max(10), label: z.string().min(1).max(28), cue: cueField}))
    .min(3)
    .max(6),
});
