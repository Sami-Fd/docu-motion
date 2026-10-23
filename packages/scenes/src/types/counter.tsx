import React from 'react';
import {Background, Canvas, Label} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';

// Placeholder: replaced by the real scene in a later task.
export const CounterScene: React.FC<SceneProps<SceneOf<'counter'>>> = ({spec}) => (
  <Canvas>
    <Background />
    <Label title={spec.title} />
  </Canvas>
);
