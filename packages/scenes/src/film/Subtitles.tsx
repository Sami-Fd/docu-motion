import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {useTheme} from '../theme';
import {subtitleAt} from './pure';

// Narration is split into sentences, each shown for a time proportional to its length.
export const Subtitles: React.FC<{text: string; durationFrames: number}> = ({text, durationFrames}) => {
  const frame = useCurrentFrame();
  const {font} = useTheme();
  const current = subtitleAt(text, durationFrames, frame);
  if (current === null) return null;
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
