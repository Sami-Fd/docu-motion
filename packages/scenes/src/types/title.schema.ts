import {z} from 'zod';
import {sharedFields} from './shared';

export const TitleSceneSchema = z.object({
  type: z.literal('title'),
  ...sharedFields,
  subtitle: z.string().min(1).max(70).optional(),
  decor: z.enum(['hills', 'sea', 'none']),
  characters: z.number().int().min(0).max(6),
});
