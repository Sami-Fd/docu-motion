import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {useTheme} from './theme';

// SVG filter giving the style its look (cut paper, chalk, flat, glow). Place once in each scene <svg>.
export const StyleDefs = () => {
  const {filter} = useTheme();
  return (
    <defs>
      {filter === 'papier' && (
        <filter id="papier" x="-10%" y="-10%" width="120%" height="135%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="bruit" />
          <feDisplacementMap in="SourceGraphic" in2="bruit" scale="7" xChannelSelector="R" yChannelSelector="G" result="bord" />
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="9" result="grain" />
          <feColorMatrix in="grain" type="matrix"
            values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.2  0 0 0 0.35 -0.05" result="grainBrun" />
          <feComposite in="grainBrun" in2="bord" operator="in" result="grainMasque" />
          <feMerge result="texture">
            <feMergeNode in="bord" />
            <feMergeNode in="grainMasque" />
          </feMerge>
          <feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#5a4630" floodOpacity="0.32" />
        </filter>
      )}
      {filter === 'craie' && (
        // Wobbly edges and grainy chalk texture (holes in the material).
        <filter id="papier" x="-10%" y="-10%" width="120%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="2" result="bruit" />
          <feDisplacementMap in="SourceGraphic" in2="bruit" scale="5" xChannelSelector="R" yChannelSelector="G" result="bord" />
          <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="1" seed="7" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.55" result="trous" />
          <feComposite in="bord" in2="trous" operator="in" result="crayeux" />
          <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#000" floodOpacity="0.35" />
        </filter>
      )}
      {filter === 'plat' && (
        <filter id="papier" x="-10%" y="-10%" width="120%" height="135%">
          <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#1f2a44" floodOpacity="0.12" />
        </filter>
      )}
      {filter === 'lueur' && (
        <filter id="papier" x="-20%" y="-20%" width="140%" height="150%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="flou" />
          <feColorMatrix in="flou" type="matrix" values="1 0 0 0 0.1  0 1 0 0 0.15  0 0 1 0 0.35  0 0 0 0.7 0" result="halo" />
          <feMerge>
            <feMergeNode in="halo" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      )}
    </defs>
  );
};

// Spring with a small bounce: the piece "jumps" into place like a collage.
export const useSpringIn = (delay: number, bounce = true) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: f - delay, fps, config: bounce ? {damping: 11, stiffness: 140} : {damping: 200}});
};

// A piece that grows from its anchor point (cx, cy).
export const Pop: React.FC<{cx: number; cy: number; delay?: number; children: React.ReactNode}> = ({
  cx, cy, delay = 0, children,
}) => {
  const s = useSpringIn(delay);
  return (
    <g filter="url(#papier)" transform={`translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`}>
      {children}
    </g>
  );
};

// A piece that slides in from an offset (dx, dy) to its place.
export const Slide: React.FC<{dx?: number; dy?: number; delay?: number; children: React.ReactNode}> = ({
  dx = 0, dy = 0, delay = 0, children,
}) => {
  const p = useSpringIn(delay, false);
  return (
    <g filter="url(#papier)" transform={`translate(${dx * (1 - p)} ${dy * (1 - p)})`}>
      {children}
    </g>
  );
};

// Paper label with a title and a short sentence (one idea per scene).
export const Label: React.FC<{title: string; text?: string; x?: number; y?: number; delay?: number; width?: number}> = ({
  title, text, x = 960, y = 150, delay = 10, width = 1000,
}) => {
  const {colors, font} = useTheme();
  const h = text ? 190 : 130;
  const s = useSpringIn(delay);
  const pText = useSpringIn(delay + 12, false);
  return (
    <g transform={`translate(${x} ${y}) scale(${s}) rotate(${-1.5 * s})`}>
      <g filter="url(#papier)">
        <rect x={-width / 2} y={-h / 2} width={width} height={h} rx={26} fill={colors.etiquette} />
      </g>
      <text y={text ? -18 : 22} textAnchor="middle" fontFamily={font} fontWeight={600} fontSize={64} fill={colors.texte}>
        {title}
      </text>
      {text && (
        <text y={52} textAnchor="middle" fontFamily={font} fontWeight={500} fontSize={38} fill={colors.texte} opacity={pText}>
          {text}
        </text>
      )}
    </g>
  );
};

// Water drop with two small eyes: our main character.
export const Drop: React.FC<{x: number; y: number; size?: number; eyes?: boolean}> = ({x, y, size = 1, eyes = true}) => {
  const {colors} = useTheme();
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <path d="M0 -40 C 18 -14, 30 4, 30 18 A 30 30 0 0 1 -30 18 C -30 4, -18 -14, 0 -40 Z" fill={colors.goutte} />
      <ellipse cx={-11} cy={10} rx={6} ry={10} fill="white" opacity={0.55} />
      {eyes && (
        <>
          <circle cx={-9} cy={20} r={3.6} fill="#3a2c20" />
          <circle cx={9} cy={20} r={3.6} fill="#3a2c20" />
        </>
      )}
    </g>
  );
};

export const Cloud: React.FC<{x: number; y: number; size?: number; color?: string}> = ({x, y, size = 1, color}) => {
  const {colors} = useTheme();
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`} fill={color ?? colors.nuage}>
      <circle cx={-70} cy={10} r={50} />
      <circle cx={0} cy={-20} r={70} />
      <circle cx={75} cy={5} r={55} />
      <rect x={-120} y={10} width={250} height={55} rx={27} />
    </g>
  );
};

export const Sun: React.FC<{x: number; y: number; r?: number}> = ({x, y, r = 90}) => {
  const f = useCurrentFrame();
  const {colors} = useTheme();
  return (
    <g transform={`translate(${x} ${y})`}>
      <g transform={`rotate(${f * 0.4})`}>
        {Array.from({length: 12}).map((_, i) => (
          <rect key={i} x={-9} y={-r - 48} width={18} height={36} rx={9} fill={colors.soleilBord} transform={`rotate(${i * 30})`} />
        ))}
      </g>
      <circle r={r} fill={colors.soleil} />
    </g>
  );
};

// Sea waves that undulate gently.
export const Sea: React.FC<{y?: number}> = ({y = 860}) => {
  const f = useCurrentFrame();
  const {colors} = useTheme();
  const wave = (offset: number, amp: number) => {
    let d = `M -50 ${y}`;
    for (let x = -50; x <= 1970; x += 40) {
      d += ` L ${x} ${y + Math.sin(x / 90 + f / 12 + offset) * amp}`;
    }
    return d + ' L 1970 1100 L -50 1100 Z';
  };
  return (
    <g filter="url(#papier)">
      <path d={wave(0, 14)} fill={colors.mer} />
      <path d={wave(2, 10)} transform="translate(0 70)" fill={colors.merFonce} />
    </g>
  );
};

// Cream background + sky, shared by all scenes.
export const Background: React.FC<{sky?: string}> = ({sky}) => {
  const {colors} = useTheme();
  return (
    <>
      <rect width={1920} height={1080} fill={colors.creme} />
      <rect x={30} y={30} width={1860} height={1020} rx={40} fill={sky ?? colors.ciel} filter="url(#papier)" />
    </>
  );
};

export const clampInterp = (f: number, a: number[], b: number[]) =>
  interpolate(f, a, b, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

// Little paper character. `elderly` adds grey hair and a cane.
export const Character: React.FC<{x: number; y: number; color: string; size?: number; elderly?: boolean; phase?: number}> = ({
  x, y, color, size = 1, elderly = false, phase = 0,
}) => {
  const f = useCurrentFrame();
  const hop = Math.abs(Math.sin(f / 10 + phase)) * 6;
  return (
    <g transform={`translate(${x} ${y - hop}) scale(${size})`}>
      {elderly && <rect x={34} y={-60} width={7} height={70} rx={3} fill="#8a6a4a" />}
      <rect x={-34} y={-70} width={68} height={80} rx={30} fill={color} />
      <circle cx={0} cy={-100} r={28} fill="#f1c9a0" />
      {elderly && <path d="M -28 -104 A 28 28 0 0 1 28 -104 L 22 -112 A 22 22 0 0 0 -22 -112 Z" fill="#e6e6e6" />}
      {!elderly && <path d="M -28 -102 A 28 28 0 0 1 28 -102 Q 0 -118 -28 -102 Z" fill="#5b3b25" />}
      <circle cx={-9} cy={-98} r={3.2} fill="#3a2c20" />
      <circle cx={9} cy={-98} r={3.2} fill="#3a2c20" />
    </g>
  );
};

// Euro coin.
export const Coin: React.FC<{x: number; y: number; size?: number}> = ({x, y, size = 1}) => {
  const {font} = useTheme();
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <circle r={22} fill="#f5c542" />
      <circle r={16} fill="none" stroke="#d9a520" strokeWidth={3} />
      <text y={8} textAnchor="middle" fontFamily={font} fontWeight={600} fontSize={24} fill="#a87a10">€</text>
    </g>
  );
};

// SVG text in the film's font.
export const Text: React.FC<{
  x: number; y: number; size?: number; bold?: boolean; color?: string; anchor?: 'start' | 'middle' | 'end';
  opacity?: number; onBackground?: boolean; children: React.ReactNode;
}> = ({x, y, size = 40, bold = false, color, anchor = 'middle', opacity = 1, onBackground = false, children}) => {
  const {colors, font} = useTheme();
  return (
    <text x={x} y={y} textAnchor={anchor} fontFamily={font} fontWeight={bold ? 600 : 500} fontSize={size}
      fill={color ?? (onBackground ? colors.texteFond : colors.texte)} opacity={opacity}>
      {children}
    </text>
  );
};

// Scene SVG canvas (1920x1080): style filters + rounded frame that clips overflow.
export const Canvas: React.FC<{children: React.ReactNode}> = ({children}) => (
  <svg viewBox="0 0 1920 1080" width="100%" height="100%">
    <StyleDefs />
    <clipPath id="cadre"><rect x={30} y={30} width={1860} height={1020} rx={40} /></clipPath>
    <g clipPath="url(#cadre)">{children}</g>
  </svg>
);

const hill = (yBase: number, amp: number, shift = 0) =>
  `M 30 1050 L 30 ${yBase} Q ${480 + shift} ${yBase - amp} ${960 + shift} ${yBase} T 1890 ${yBase} L 1890 1050 Z`;

export const Hills = ({delay = 0}: {delay?: number}) => {
  const {colors} = useTheme();
  return (
    <>
      <Slide dy={500} delay={delay}><path d={hill(760, 160, 120)} fill={colors.colline1} /></Slide>
      <Slide dy={500} delay={delay + 6}><path d={hill(850, 120, -200)} fill={colors.colline2} /></Slide>
      <Slide dy={500} delay={delay + 12}><path d={hill(950, 90, 60)} fill={colors.colline3} /></Slide>
    </>
  );
};

// Ring-segment path for donut charts (angles in radians, 0 at the top, clockwise).
export const arc = (cx: number, cy: number, R: number, r: number, a0: number, a1: number) => {
  const pt = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
};
