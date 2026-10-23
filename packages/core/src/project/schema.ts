import {z} from 'zod';
import {SceneSpecSchema} from '@docu-motion/scenes';

export const PROJECT_VERSION = 1 as const;

export const StyleNameSchema = z.enum(['papier', 'craie', 'infographie', 'nuit']);
export type StyleName = z.infer<typeof StyleNameSchema>;

export const ProviderRefSchema = z.object({
  kind: z.enum(['api', 'cli', 'fake']),
  provider: z.string(),
  model: z.string().optional(),
});
export type ProviderRef = z.infer<typeof ProviderRefSchema>;

export const ProjectSchema = z.object({
  version: z.literal(PROJECT_VERSION),
  brief: z.object({
    topic: z.string(),
    language: z.string(),
    targetMinutes: z.number(),
    style: StyleNameSchema,
    tone: z.string().optional(),
    provider: ProviderRefSchema,
    webSearch: z.enum(['off', 'native', 'tavily', 'brave']),
  }),
  sources: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['url', 'file', 'search']),
      title: z.string(),
      uri: z.string(),
      textPath: z.string(),
      error: z.string().optional(),
    }),
  ),
  facts: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      value: z.string().optional(),
      sourceId: z.string().optional(),
      excerpt: z.string().optional(),
      verified: z.boolean(),
    }),
  ),
  scenes: z.array(
    z.object({
      id: z.string(),
      narration: z.string(),
      spec: SceneSpecSchema,
      status: z.enum(['ok', 'fallback', 'review']),
      audio: z.object({path: z.string(), seconds: z.number()}).optional(),
      durationFrames: z.number(),
    }),
  ),
  voice: z.object({
    engine: z.enum(['edge', 'elevenlabs', 'openai', 'upload', 'none']),
    voiceId: z.string().optional(),
  }),
  youtube: z
    .object({
      titles: z.array(z.string()),
      description: z.string(),
      chapters: z.array(z.object({t: z.string(), label: z.string()})),
      hashtags: z.array(z.string()),
    })
    .optional(),
  thumbnail: z.object({spec: z.unknown()}).optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
