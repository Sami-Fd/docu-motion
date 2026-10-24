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

/** A scene id names its still (out/stills/<id>.png) and is a React key, hence the narrow alphabet. */
export const SceneIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,
    'Scene id must be 1-64 characters: letters, digits, "_" or "-", starting with a letter or digit',
  );

const uniqueSceneIds = (scenes: {id: string}[], ctx: z.RefinementCtx): void => {
  const first = new Map<string, number>();
  scenes.forEach((s, i) => {
    const seen = first.get(s.id);
    if (seen === undefined) first.set(s.id, i);
    else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'id'],
        message: `Duplicate scene id "${s.id}" (already used by scene ${seen})`,
      });
    }
  });
};

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
  scenes: z
    .array(
      z.object({
        id: SceneIdSchema,
        narration: z.string(),
        spec: SceneSpecSchema,
        status: z.enum(['ok', 'fallback', 'review']),
        audio: z.object({path: z.string(), seconds: z.number()}).optional(),
        durationFrames: z.number().int().positive(),
      }),
    )
    .superRefine(uniqueSceneIds),
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
