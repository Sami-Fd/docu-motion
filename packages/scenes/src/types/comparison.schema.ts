import {z} from 'zod';
import {cueField, sharedFields} from './shared';

const SideSchema = z.object({
  heading: z.string().min(1).max(24),
  value: z.string().min(1).max(12),
  caption: z.string().min(1).max(40).optional(),
  cue: cueField,
});

export const ComparisonSceneSchema = z.object({
  type: z.literal('comparison'),
  ...sharedFields,
  left: SideSchema,
  right: SideSchema,
});
