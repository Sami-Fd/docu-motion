import {z} from 'zod';
import {SceneSpecSchema, ThumbnailSpecSchema} from '@docu-motion/scenes';

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

export const STEP_NAMES = ['sources', 'facts', 'script', 'scenes', 'voice', 'layout', 'render', 'package'] as const;
export const StepNameSchema = z.enum(STEP_NAMES);
export type StepName = z.infer<typeof StepNameSchema>;

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
    /** User URLs, and file paths relative to the project dir. */
    sources: z.array(z.string()).default([]),
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
        audio: z.object({path: z.string(), seconds: z.number(), hash: z.string().optional()}).optional(),
        durationFrames: z.number().int().positive(),
        factIds: z.array(z.string()).default([]),
        warnings: z.array(z.string()).default([]),
        dirty: z.boolean().optional(),
      }),
    )
    .superRefine(uniqueSceneIds),
  voice: z.object({
    engine: z.enum(['edge', 'elevenlabs', 'openai', 'upload', 'none']),
    voiceId: z.string().optional(),
    /** The default voice found for `resolvedEngine`, kept so cached audio is verifiable offline. Cleared by setVoice. */
    resolvedVoiceId: z.string().optional(),
    resolvedEngine: z.enum(['edge', 'elevenlabs', 'openai']).optional(),
  }),
  progress: z
    .object({
      done: z.array(StepNameSchema),
      failed: z.object({step: StepNameSchema, message: z.string()}).optional(),
    })
    .default({done: []}),
  youtube: z
    .object({
      titles: z.array(z.string()),
      description: z.string(),
      chapters: z.array(z.object({t: z.string(), label: z.string()})),
      hashtags: z.array(z.string()),
      warnings: z.array(z.string()).default([]),
      /** Kept so a re-run of the package step reuses the user's copy instead of asking the LLM again. */
      hook: z.string().optional(),
    })
    .optional(),
  // Plan 1/2 projects stored `{spec}`; that shape carries nothing the package step can use, so it loads as "no thumbnail".
  thumbnail: z
    .union([
      z
        .object({options: z.array(ThumbnailSpecSchema), chosen: z.number().int().min(0), file: z.string()})
        .refine((t) => t.chosen < t.options.length, {message: 'thumbnail.chosen must index one of the options', path: ['chosen']}),
      z
        .object({spec: z.unknown()})
        .strict()
        .refine((o) => 'spec' in o)
        .transform((): undefined => undefined),
    ])
    .optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
