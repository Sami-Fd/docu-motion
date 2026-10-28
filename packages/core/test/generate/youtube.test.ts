import {describe, expect, it} from 'vitest';
import {chapters, describe as describeVideo, YoutubeOutputSchema} from '../../src/generate/youtube.js';
import {demoResponder} from '../../src/llm/demoResponder.js';
import {ThumbnailsOutputSchema} from '../../src/generate/steps/package.js';
import type {Project} from '../../src/project/schema.js';

const scene = (i: number, seconds: number) => ({
  id: `s${i}`,
  narration: `Narration ${i}`,
  spec: {type: 'title', title: `Titre ${i}`, decor: 'none', characters: 0},
  status: 'ok',
  durationFrames: Math.round(seconds * 30),
  factIds: [] as string[],
  warnings: [],
});
const project = (seconds: number[], extra: Record<string, unknown> = {}): Project =>
  ({
    version: 1,
    brief: {topic: 'Les retraites', language: 'fr'},
    sources: [],
    facts: [],
    scenes: seconds.map((s, i) => scene(i + 1, s)),
    voice: {engine: 'none'},
    progress: {done: []},
    ...extra,
  }) as unknown as Project;

describe('chapters', () => {
  it('merges a scene under 10 s into the previous chapter, keeping the earlier label', () => {
    const ch = chapters(project([10, 20, 5, 30, 12]));
    expect(ch.map((c) => c.t)).toEqual(['0:00', '0:10', '0:35', '1:05']);
    expect(ch.map((c) => c.label)).toEqual(['Titre 1', 'Titre 2', 'Titre 4', 'Titre 5']);
  });
  it('merges a short last scene too', () => {
    expect(chapters(project([12, 12, 12, 4])).map((c) => c.t)).toEqual(['0:00', '0:12', '0:24']);
  });
  it('returns [] when fewer than 3 chapters remain', () => {
    expect(chapters(project([30, 5, 20, 6]))).toEqual([]);
    expect(chapters(project([30, 30]))).toEqual([]);
  });
  it('formats h:mm:ss from one hour', () => {
    expect(chapters(project([3600, 40, 60])).map((c) => c.t)).toEqual(['0:00', '1:00:00', '1:00:40']);
    expect(chapters(project([20, 3680, 30]))[2]!.t).toBe('1:01:40');
  });
});

const out = {
  titles: ['A', 'B', 'C'],
  hook: 'Une phrase. Une autre phrase.',
  hashtags: ['#retraites', '#france', '#economie'],
};

describe('describe', () => {
  it('assembles hook, chapters, deduped sources and hashtags in order', () => {
    const p = project([12, 12, 12], {
      sources: [
        {id: 'a', kind: 'url', title: 'Source A', uri: 'https://a.example', textPath: 'x'},
        {id: 'b', kind: 'url', title: 'Source B', uri: 'https://b.example', textPath: 'y'},
        {id: 'c', kind: 'url', title: 'Unused', uri: 'https://c.example', textPath: 'z'},
      ],
      facts: [
        {id: 'f1', statement: 's', verified: true, sourceId: 'b'},
        {id: 'f2', statement: 's', verified: true, sourceId: 'a'},
        {id: 'f3', statement: 's', verified: true},
      ],
    });
    p.scenes[0]!.factIds = ['f1', 'f3'];
    p.scenes[1]!.factIds = ['f2', 'f1'];
    const text = describeVideo(p, out, chapters(p));
    expect(text.startsWith('Une phrase. Une autre phrase.\n\n0:00 Titre 1\n0:12 Titre 2\n0:24 Titre 3\n\n')).toBe(true);
    expect(text).toContain('Sources:\n- Source B — https://b.example\n- Source A — https://a.example\n');
    expect(text).not.toContain('Unused');
    expect(text.endsWith('#retraites #france #economie')).toBe(true);
  });
  it('omits the chapters block when there are none', () => {
    const text = describeVideo(project([12]), out, []);
    expect(text).toBe('Une phrase. Une autre phrase.\n\n#retraites #france #economie');
  });
});

describe('YoutubeOutputSchema', () => {
  it('rejects a 71 code point title and accepts 70', () => {
    expect(YoutubeOutputSchema.safeParse({...out, titles: ['a'.repeat(70), 'B', 'C']}).success).toBe(true);
    expect(YoutubeOutputSchema.safeParse({...out, titles: ['a'.repeat(71), 'B', 'C']}).success).toBe(false);
  });
  it('counts code points, not UTF-16 units', () => {
    expect(YoutubeOutputSchema.safeParse({...out, titles: ['😀'.repeat(70), 'B', 'C']}).success).toBe(true);
  });
  it('needs 3 titles, a bounded hook and 3 to 5 well-formed hashtags', () => {
    expect(YoutubeOutputSchema.safeParse({...out, titles: ['A', 'B']}).success).toBe(false);
    expect(YoutubeOutputSchema.safeParse({...out, hook: 'x'.repeat(401)}).success).toBe(false);
    expect(YoutubeOutputSchema.safeParse({...out, hashtags: ['#aa', '#bb']}).success).toBe(false);
    expect(YoutubeOutputSchema.safeParse({...out, hashtags: ['#ok', '#ok2', 'noHash']}).success).toBe(false);
    expect(YoutubeOutputSchema.safeParse({...out, hashtags: ['#a', '#bb', '#cc']}).success).toBe(false);
    expect(YoutubeOutputSchema.safeParse({...out, hashtags: ['#économie', '#a_b', '#12']}).success).toBe(true);
    expect(YoutubeOutputSchema.safeParse({...out, hashtags: ['#aa', '#bb', '#cc', '#dd', '#ee', '#ff']}).success).toBe(false);
  });
});

describe('demoResponder', () => {
  it('answers both new schemas with valid output', () => {
    const prompt = 'Topic: La dette publique française\n\nPropose 3 thumbnails';
    const t = demoResponder({schema: ThumbnailsOutputSchema, system: '', prompt});
    expect(ThumbnailsOutputSchema.safeParse(t).success).toBe(true);
    const y = demoResponder({schema: YoutubeOutputSchema, system: '', prompt});
    expect(YoutubeOutputSchema.safeParse(y).success).toBe(true);
  });
});
