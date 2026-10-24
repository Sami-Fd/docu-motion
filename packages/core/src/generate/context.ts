import type {LlmProvider} from '../llm/types.js';
import type {Project, StepName} from '../project/schema.js';
import type {SearchHit} from '../research/search.js';
import type {Settings} from '../settings/settings.js';

export type StepContext = {
  projectDir: string;
  llm: LlmProvider;
  settings: Settings;
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProgress: (e: {step: StepName; ratio?: number; log?: string}) => void;
  nativeSearch?: (query: string) => Promise<SearchHit[]>;
};

export type Step = (p: Project, ctx: StepContext) => Promise<Project>;
