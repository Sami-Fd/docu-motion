import type {Project} from '../project/schema.js';

/** Per-scene warning summary printed by the CLI after a run; empty string when there is nothing to report. */
export function formatWarningSummary(p: Project): string {
  const warned = p.scenes.filter((s) => s.warnings.length > 0);
  if (warned.length === 0) return '';
  const lines = warned.flatMap((s) => s.warnings.map((w) => `  ${s.id}: ${w}`));
  return [`Warnings in ${warned.length} of ${p.scenes.length} scenes:`, ...lines].join('\n');
}
