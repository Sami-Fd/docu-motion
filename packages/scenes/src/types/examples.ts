import type {SceneOf, SceneType} from '../schema';

export const EXAMPLES: {[T in SceneType]: SceneOf<T>} = {
  title: {
    type: 'title',
    title: 'La Sécu, qui paie quoi ?',
    subtitle: 'Comprendre le financement en deux minutes',
    decor: 'hills',
    characters: 3,
  },
  bars: {
    type: 'bars',
    title: 'Dépenses par branche',
    bars: [
      {label: 'Maladie', value: 250, cue: 'maladie'},
      {label: 'Retraites', value: 340, cue: 'retraites'},
      {label: 'Famille', value: 55, cue: 'famille'},
      {label: 'Accidents', value: 15, cue: 'accidents'},
    ],
    unit: 'Md€',
    source: 'Commission des comptes de la Sécurité sociale',
  },
  donut: {
    type: 'donut',
    title: 'Le financement de la Sécu',
    parts: [
      {label: 'Cotisations sociales', value: 49, cue: 'cotisations'},
      {label: 'CSG', value: 20, cue: 'CSG'},
      {label: 'Autres impôts et taxes', value: 13, cue: 'autres impôts'},
      {label: 'TVA', value: 8, cue: 'TVA'},
      {label: 'Autres recettes', value: 10, cue: 'recettes'},
    ],
  },
  counter: {
    type: 'counter',
    title: 'Un déficit qui se creuse',
    value: 18.5,
    suffix: 'Md€',
    label: 'de déficit prévu cette année',
    cue: 'déficit',
  },
  pictograms: {
    type: 'pictograms',
    title: 'La population vieillit',
    groups: [
      {label: "Aujourd'hui", count: 7, elderly: false, ratio: '2,5', cue: "Aujourd'hui"},
      {label: 'En 2070', count: 12, elderly: true, ratio: '1,6', cue: '2070'},
    ],
    source: 'COR, rapport annuel 2026 (20-64 ans / 65 ans et plus)',
  },
  comparison: {
    type: 'comparison',
    title: 'Hier contre demain',
    left: {heading: "Aujourd'hui", value: '2,5', caption: 'actifs pour 1 senior', cue: "Aujourd'hui"},
    right: {heading: 'En 2070', value: '1,6', caption: 'actifs pour 1 senior', cue: '2070'},
  },
  quote: {
    type: 'quote',
    title: 'Un principe fondateur',
    text: 'Chacun cotise selon ses moyens et reçoit selon ses besoins.',
    author: 'Principe de la Sécurité sociale',
  },
  timeline: {
    type: 'timeline',
    title: 'Les grandes dates',
    events: [
      {date: '1945', label: 'Création de la Sécu', cue: '1945'},
      {date: '1967', label: 'Séparation des branches', cue: '1967'},
      {date: '1991', label: 'Création de la CSG', cue: '1991'},
      {date: '2004', label: 'Réforme de l’assurance', cue: '2004'},
    ],
  },
  list: {
    type: 'list',
    title: 'Les leviers possibles',
    items: [
      {text: 'Augmenter les recettes', icon: 'coin', cue: 'recettes'},
      {text: 'Réduire certaines dépenses', icon: 'drop', cue: 'dépenses'},
      {text: 'Allonger la durée de cotisation', icon: 'sun', cue: 'cotisation'},
    ],
  },
};
