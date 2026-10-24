import React from 'react';
import {Background, Canvas, Character, Cloud, Hills, Label, Pop, Sea, Sun} from '../kit';
import type {SceneProps} from '../film/types';
import type {SceneOf} from '../schema';
import {cueFrame} from '../timing';
import {PEOPLE_COLORS} from './common';

// The skill's `Titre`: decor slides in, characters pop in one after the other, big label on top.
export const TitleScene: React.FC<SceneProps<SceneOf<'title'>>> = ({spec, narration, durationFrames}) => {
  const n = spec.characters;
  const spacing = 120;
  const groundY = spec.decor === 'sea' ? 700 : 760;
  return (
    <Canvas>
      <Background />
      {spec.decor !== 'none' && (
        <>
          <Pop cx={1620} cy={590} delay={18}><Sun x={1620} y={590} r={75} /></Pop>
          <Pop cx={300} cy={600} delay={24}><Cloud x={300} y={600} size={0.75} /></Pop>
        </>
      )}
      {spec.decor === 'hills' && <Hills />}
      {spec.decor === 'sea' && <Sea y={800} />}
      {Array.from({length: n}).map((_, i) => {
        const x = 960 - ((n - 1) * spacing) / 2 + i * spacing;
        // Characters have no cue: they pop in on the fallback stagger, after the decor.
        const delay = cueFrame(narration, undefined, durationFrames, i) + 20;
        return (
          <Pop key={i} cx={x} cy={groundY} delay={delay}>
            <Character x={x} y={groundY} color={PEOPLE_COLORS[i % PEOPLE_COLORS.length]!} elderly={i === n - 1 && n > 2} phase={i} />
          </Pop>
        );
      })}
      <Label title={spec.title} text={spec.subtitle} y={340} />
    </Canvas>
  );
};
