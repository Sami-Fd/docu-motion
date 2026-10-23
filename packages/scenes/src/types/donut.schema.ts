import {z} from 'zod';
import {cueField, sharedFields} from './shared';

export const DonutSceneSchema = z.object({
  type: z.literal('donut'),
  ...sharedFields,
  parts: z
    .array(z.object({label: z.string().min(1).max(26), value: z.number().gt(0), cue: cueField}))
    .min(2)
    .max(6),
});

/** Cross-field rule: part values sum to 100 (±0.5). Applied on the scene union
 *  because discriminatedUnion members must be plain objects. */
export const checkDonutSum = (
  spec: z.infer<typeof DonutSceneSchema>,
  ctx: z.RefinementCtx,
): void => {
  const sum = spec.parts.reduce((acc, p) => acc + p.value, 0);
  if (Math.abs(sum - 100) > 0.5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parts'],
      message: `Donut part values must sum to 100 (±0.5), but they sum to ${Math.round(sum * 100) / 100}`,
    });
  }
};
