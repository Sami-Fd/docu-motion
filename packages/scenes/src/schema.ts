import {z} from 'zod';
import {BarsSceneSchema} from './types/bars.schema';
import {ComparisonSceneSchema} from './types/comparison.schema';
import {CounterSceneSchema} from './types/counter.schema';
import {DonutSceneSchema, checkDonutSum} from './types/donut.schema';
import {ListSceneSchema} from './types/list.schema';
import {PictogramsSceneSchema} from './types/pictograms.schema';
import {QuoteSceneSchema} from './types/quote.schema';
import {TimelineSceneSchema} from './types/timeline.schema';
import {TitleSceneSchema} from './types/title.schema';

export const SceneSpecSchema = z
  .discriminatedUnion('type', [
  TitleSceneSchema,
  BarsSceneSchema,
  DonutSceneSchema,
  CounterSceneSchema,
  PictogramsSceneSchema,
  ComparisonSceneSchema,
  QuoteSceneSchema,
  TimelineSceneSchema,
  ListSceneSchema,
  ])
  .superRefine((spec, ctx) => {
    if (spec.type === 'donut') checkDonutSum(spec, ctx);
  });
export type SceneSpec = z.infer<typeof SceneSpecSchema>;
export type SceneType = SceneSpec['type'];
export type SceneOf<T extends SceneType> = Extract<SceneSpec, {type: T}>;

export const SCENE_TYPES: readonly SceneType[] = [
  'title',
  'bars',
  'donut',
  'counter',
  'pictograms',
  'comparison',
  'quote',
  'timeline',
  'list',
];

export {EXAMPLES} from './types/examples';
