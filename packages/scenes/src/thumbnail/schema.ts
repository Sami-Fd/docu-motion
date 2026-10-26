import {z} from 'zod';

// Lengths count code points, not UTF-16 units: "Sécu 🏥" is 6.
const codePoints = (min: number, max: number) =>
  z.string().refine((s) => {
    const n = [...s].length;
    return n >= min && n <= max;
  }, {message: min > 0 ? `must be ${min} to ${max} characters` : `must be at most ${max} characters`});

export const ThumbnailSpecSchema = z
  .object({
    words: z.array(codePoints(1, 14)).min(2).max(4),
    figure: codePoints(0, 12).optional(),
    characters: z.number().int().min(1).max(2),
    element: z.enum(['arrow-up', 'arrow-down', 'question', 'exclamation', 'coin', 'none']),
    // Index of the word drawn in the accent colour.
    highlight: z.number().int().min(0).max(3),
  })
  .superRefine((spec, ctx) => {
    if (spec.highlight >= spec.words.length) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path: ['highlight'], message: `highlight ${spec.highlight} is not one of the ${spec.words.length} words`});
    }
  });

export type ThumbnailSpec = z.infer<typeof ThumbnailSpecSchema>;

export const THUMBNAIL_EXAMPLES: ThumbnailSpec[] = [
  {words: ['LA SÉCU', 'EST', 'EN DANGER'], figure: '-18 Md€', characters: 2, element: 'arrow-down', highlight: 2},
  {words: ['QUI PAIE', 'VOS', 'RETRAITES ?'], figure: '2,5 → 1,6', characters: 2, element: 'question', highlight: 0},
  {words: ['CSG', 'TVA', 'COTISATIONS'], characters: 1, element: 'coin', highlight: 2},
];
