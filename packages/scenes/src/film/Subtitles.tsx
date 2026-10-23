import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {useTheme} from '../theme';

// Narration is split into sentences, each shown for a time proportional to its length.
export const Subtitles: React.FC<{text: string; durationFrames: number}> = ({text, durationFrames}) => {
  const frame = useCurrentFrame();
  const {font} = useTheme();
  const sentences = text.split(/(?<=[.?!])\s+/);
  const total = sentences.reduce((a, s) => a + s.length, 0);
  const usable = durationFrames - 20;
  let start = 5;
  let current = sentences[sentences.length - 1] ?? '';
  for (const s of sentences) {
    const d = (s.length / total) * usable;
    if (frame < start + d) {
      current = s;
      break;
    }
    start += d;
  }
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 62}}>
      <div
        style={{
          fontFamily: font, fontWeight: 500, fontSize: 38, lineHeight: 1.3, color: '#fff',
          background: 'rgba(30,25,20,0.82)', padding: '12px 30px', borderRadius: 14, maxWidth: 1500, textAlign: 'center',
        }}
      >
        {current}
      </div>
    </AbsoluteFill>
  );
};
