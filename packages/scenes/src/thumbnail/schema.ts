import {z} from 'zod';

// Lengths count code points of the NFC-normalised text, not UTF-16 units: "Sécu 🏥" is 6, and a decomposed
// "é" (e + U+0301) is 1. `.max(28)` is the UTF-16 upper bound of the limit, so the JSON Schema sent to the
// LLM carries a maxLength without changing what is accepted.
const codePoints = (min: number, max: number, description: string) =>
  z.string().max(max * 2).describe(description).refine((s) => {
    const n = [...s.normalize('NFC')].length;
    return n >= min && n <= max;
  }, {message: min > 0 ? `must be ${min} to ${max} characters` : `must be at most ${max} characters`});

export const ThumbnailSpecSchema = z
  .object({
    words: z.array(codePoints(1, 14, '1 to 14 characters: one short word, in uppercase')).min(2).max(4)
      .describe('2 to 4 words, one per line, shown huge'),
    figure: codePoints(0, 12, 'At most 12 characters: a short figure such as "-18 Md€"').optional(),
    characters: z.number().int().min(1).max(2),
    element: z.enum(['arrow-up', 'arrow-down', 'question', 'exclamation', 'coin', 'none']),
    highlight: z.number().int().min(0).max(3)
      .describe('Index into words (0-based) of the word drawn in the accent colour; must be smaller than the number of words'),
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
