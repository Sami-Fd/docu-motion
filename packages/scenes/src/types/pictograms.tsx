import React from 'react';
import {Background, Canvas, Label} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';

// Placeholder: replaced by the real scene in a later task.
export const PictogramsScene: React.FC<SceneProps<SceneOf<'pictograms'>>> = ({spec}) => (
  <Canvas>
    <Background />
    <Label title={spec.title} />
  </Canvas>
);
