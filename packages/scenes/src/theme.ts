import React from 'react';
import {loadFont as caveat} from '@remotion/google-fonts/Caveat';
import {loadFont as fredoka} from '@remotion/google-fonts/Fredoka';
import {loadFont as poppins} from '@remotion/google-fonts/Poppins';
import {loadFont as spaceGrotesk} from '@remotion/google-fonts/SpaceGrotesk';

export type StyleName = 'papier' | 'craie' | 'infographie' | 'nuit';

// Colour values are copied verbatim from the skill's theme.ts.
const PAPIER = {
  creme: '#fbf3e4',
  ciel: '#cfe8ef',
  ciel2: '#c3dde8',
  ciel3: '#b9cbd6',
  soleil: '#ffc94d',
  soleilBord: '#f5a623',
  colline1: '#9fd18b',
  colline2: '#6fb36b',
  colline3: '#4f9a5c',
  mer: '#6cb7d9',
  merFonce: '#3f8fbf',
  goutte: '#4fa3e0',
  nuage: '#ffffff',
  nuageGris: '#c9d3dc',
  montagne: '#b7a28c',
  neige: '#ffffff',
  texte: '#4a3b2c',
  texteFond: '#4a3b2c',
  etiquette: '#fff8ea',
  accent: '#e8735a',
};

export type Palette = typeof PAPIER;
export type FilterName = 'papier' | 'craie' | 'plat' | 'lueur';

export type Theme = {name: StyleName; colors: Palette; filter: FilterName; font: string};

type StyleDef = {colors: Palette; filter: FilterName; family: string; load: () => string};

const subsets = ['latin', 'latin-ext'] as ('latin' | 'latin-ext')[];

const STYLES: Record<StyleName, StyleDef> = {
  papier: {
    colors: PAPIER,
    filter: 'papier',
    family: 'Fredoka',
    load: () => fredoka('normal', {weights: ['500', '600'], subsets}).fontFamily,
  },
  craie: {
    colors: {
      ...PAPIER, creme: '#2a2420', ciel: '#2f4a3c', ciel2: '#2c4538', ciel3: '#293f34', colline1: '#4d6b55', colline2: '#425e4a',
      colline3: '#38513f', mer: '#4f7f8f', merFonce: '#3d6876', montagne: '#6b6358', nuageGris: '#9aa5a0', texteFond: '#f4f1e8',
      etiquette: '#f6f0dc',
    },
    filter: 'craie',
    family: 'Caveat',
    load: () => caveat('normal', {weights: ['500', '700'], subsets}).fontFamily,
  },
  infographie: {
    colors: {
      ...PAPIER, creme: '#e9edf5', ciel: '#f7f9fc', ciel2: '#eef3f9', ciel3: '#e6ecf3', colline1: '#b8e0c8', colline2: '#8fcfa9',
      colline3: '#66bb8a', texte: '#1f2a44', texteFond: '#1f2a44', etiquette: '#ffffff',
    },
    filter: 'plat',
    family: 'Poppins',
    load: () => poppins('normal', {weights: ['500', '600'], subsets}).fontFamily,
  },
  nuit: {
    colors: {
      ...PAPIER, creme: '#070914', ciel: '#121734', ciel2: '#10142d', ciel3: '#0e1228', colline1: '#24406a', colline2: '#1c3458',
      colline3: '#152846', mer: '#2c6fb0', merFonce: '#1f5590', montagne: '#3a3f63', nuage: '#dfe6ff', nuageGris: '#8a93b8',
      texte: '#141a33', texteFond: '#eef1ff', etiquette: '#e9edff',
    },
    filter: 'lueur',
    family: 'Space Grotesk',
    load: () => spaceGrotesk('normal', {weights: ['500', '600'], subsets}).fontFamily,
  },
};

const isStyleName = (s: string | undefined): s is StyleName => s !== undefined && Object.hasOwn(STYLES, s);

const loaded = new Map<StyleName, string>();

// Google fonts are only loaded in a browser context (render time), lazily and once per style.
// In Node (unit tests, project loading) the family name is returned without loading anything.
const fontFor = (name: StyleName): string => {
  const def = STYLES[name];
  if (typeof document === 'undefined') return def.family;
  let family = loaded.get(name);
  if (family === undefined) {
    family = def.load();
    loaded.set(name, family);
  }
  return family;
};

export const getTheme = (style: string | undefined): Theme => {
  const name: StyleName = isStyleName(style) ? style : 'papier';
  const def = STYLES[name];
  return {name, colors: def.colors, filter: def.filter, font: fontFor(name)};
};

const ThemeContext = React.createContext<Theme | null>(null);

export const ThemeProvider: React.FC<{style: StyleName; children?: React.ReactNode}> = ({style, children}) =>
  React.createElement(ThemeContext.Provider, {value: getTheme(style)}, children);

export const useTheme = (): Theme => React.useContext(ThemeContext) ?? getTheme('papier');
