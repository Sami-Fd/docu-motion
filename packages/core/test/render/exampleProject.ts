import {EXAMPLES, SCENE_TYPES, type SceneType, type StyleName} from '@docu-motion/scenes';
import type {Project} from '../../src/index.js';

// Narration for each example scene. Every cue of the example appears in the first two thirds
// of its text, so all elements have finished animating at 80 % of a 300-frame scene.
export const EXAMPLE_NARRATION: Record<SceneType, string> = {
  title: 'La Sécu, tout le monde en parle. Mais qui la paie, et pour quoi faire ? On vous explique tout en deux minutes.',
  bars: 'La maladie coûte cher, les retraites encore plus, la famille un peu, les accidents très peu. Voilà où va l’argent chaque année.',
  donut: 'Les cotisations sociales, la CSG, les autres impôts, la TVA et quelques recettes diverses financent le système tout entier, année après année.',
  counter: 'Le déficit prévu cette année dépasse les dix-huit milliards d’euros, et il continue de se creuser depuis plusieurs années.',
  pictograms: "Aujourd'hui, on compte deux virgule cinq actifs par senior. En 2070, ce ne sera plus que un virgule six, selon les projections officielles.",
  comparison: "Aujourd'hui deux virgule cinq actifs pour un senior, en 2070 seulement un virgule six. L’écart se creuse avec le temps qui passe.",
  quote: 'Le principe est simple et fondateur : chacun cotise selon ses moyens, et reçoit selon ses besoins. Une idée qui tient toujours.',
  timeline: 'En 1945, la Sécu est créée. En 1967, les branches sont séparées. En 1991 arrive la CSG, puis en 2004 une réforme de l’assurance maladie.',
  list: 'Pour équilibrer les comptes, on peut augmenter les recettes, réduire certaines dépenses, ou allonger la durée de cotisation des actifs.',
};

/** A project with one scene per example type (ids = type names), each lasting `durationFrames`. */
export const exampleProject = (style: StyleName, durationFrames = 300): Project => ({
  version: 1,
  brief: {
    topic: 'Sécu',
    language: 'fr',
    targetMinutes: 2,
    style,
    provider: {kind: 'fake', provider: 'fake'},
    webSearch: 'off',
    sources: [],
  },
  sources: [],
  facts: [],
  scenes: SCENE_TYPES.map((t) => ({
    id: t,
    narration: EXAMPLE_NARRATION[t],
    spec: EXAMPLES[t],
    status: 'ok' as const,
    durationFrames,
    factIds: [],
    warnings: [],
  })),
  voice: {engine: 'none'},
  progress: {done: []},
});
