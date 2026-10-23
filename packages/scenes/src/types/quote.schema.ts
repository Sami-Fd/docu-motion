import {z} from 'zod';
import {sharedFields} from './shared';

export const QuoteSceneSchema = z.object({
  type: z.literal('quote'),
  ...sharedFields,
  text: z.string().min(1).max(180),
  author: z.string().min(1).max(40),
});
