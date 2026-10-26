import {redact} from '../llm/redact.js';
import {STEP_NAMES, type Project, type StepName} from '../project/schema.js';
import {loadProject, saveProject} from '../project/store.js';
import type {Step, StepContext} from './context.js';
import {factsStep} from './steps/facts.js';
import {layoutStep} from './steps/layout.js';
import {renderStep} from './steps/render.js';
import {scenesStep} from './steps/scenes.js';
import {scriptStep} from './steps/script.js';
import {sourcesStep} from './steps/sources.js';
import {voiceStep} from './steps/voice.js';

export class GenerateCancelled extends Error {
  constructor() {
    super('Generation cancelled');
    this.name = 'GenerateCancelled';
  }
}

export class StepFailedError extends Error {
  step: StepName;
  constructor(step: StepName, message: string) {
    super(message);
    this.name = 'StepFailedError';
    this.step = step;
  }
}

export const STEPS: Record<StepName, Step> = {
  sources: sourcesStep,
  facts: factsStep,
  script: scriptStep,
  scenes: scenesStep,
  voice: voiceStep(),
  layout: layoutStep(),
  render: renderStep,
};

const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || e.name === 'GenerateCancelled');

export async function generate(
  projectDir: string,
  ctx: Omit<StepContext, 'projectDir'>,
  deps: {steps?: Partial<Record<StepName, Step>>} = {},
): Promise<Project> {
  const steps = {...STEPS, ...deps.steps};
  const secrets = Object.values(ctx.settings.keys).filter((v): v is string => typeof v === 'string' && v.length > 0);
  let p = await loadProject(projectDir);
  if (p.progress.failed) {
    const {failed: _drop, ...progress} = p.progress;
    p = {...p, progress};
    await saveProject(projectDir, p);
  }
  const full: StepContext = {...ctx, projectDir};
  for (const name of STEP_NAMES) {
    if (p.progress.done.includes(name)) continue;
    if (ctx.signal?.aborted) throw new GenerateCancelled();
    ctx.onProgress({step: name, ratio: 0});
    try {
      p = await steps[name]!(p, full);
    } catch (e) {
      if (ctx.signal?.aborted || isAbort(e)) throw new GenerateCancelled();
      const message = redact(e instanceof Error ? e.message : String(e), secrets);
      p = {...p, progress: {...p.progress, failed: {step: name, message}}};
      await saveProject(projectDir, p);
      throw new StepFailedError(name, message);
    }
    p = {...p, progress: {...p.progress, done: [...p.progress.done, name]}};
    await saveProject(projectDir, p);
    ctx.onProgress({step: name, ratio: 1});
  }
  return p;
}
