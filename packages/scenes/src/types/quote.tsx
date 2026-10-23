import React from 'react';
import {Background, Canvas, Label} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';

// Placeholder: replaced by the real scene in a later task.
export const QuoteScene: React.FC<SceneProps<SceneOf<'quote'>>> = ({spec}) => (
  <Canvas>
    <Background />
    <Label title={spec.title} />
  </Canvas>
);
