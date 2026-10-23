import React from 'react';
import type {SceneSpec, SceneType} from '../schema';
import type {SceneProps} from './types';
import {TitleScene} from '../types/title';
import {BarsScene} from '../types/bars';
import {DonutScene} from '../types/donut';
import {CounterScene} from '../types/counter';
import {PictogramsScene} from '../types/pictograms';
import {ComparisonScene} from '../types/comparison';
import {QuoteScene} from '../types/quote';
import {TimelineScene} from '../types/timeline';
import {ListScene} from '../types/list';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SCENE_COMPONENTS: Record<SceneType, React.FC<SceneProps<any>>> = {
  title: TitleScene,
  bars: BarsScene,
  donut: DonutScene,
  counter: CounterScene,
  pictograms: PictogramsScene,
  comparison: ComparisonScene,
  quote: QuoteScene,
  timeline: TimelineScene,
  list: ListScene,
};

export const SceneView: React.FC<SceneProps<SceneSpec>> = (props) => {
  const Component = SCENE_COMPONENTS[props.spec.type];
  return <Component {...props} />;
};
