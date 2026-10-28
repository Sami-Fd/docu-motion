import type {Project} from '../project/schema.js';

/** Warning summary printed by the CLI after a run (scenes, then the YouTube kit); empty string when there is nothing to report. */
export function formatWarningSummary(p: Project): string {
  const warned = p.scenes.filter((s) => s.warnings.length > 0);
  const lines: string[] = [];
  if (warned.length > 0) {
    lines.push(`Warnings in ${warned.length} of ${p.scenes.length} scenes:`, ...warned.flatMap((s) => s.warnings.map((w) => `  ${s.id}: ${w}`)));
  }
  const yt = p.youtube?.warnings ?? [];
  if (yt.length > 0) lines.push('YouTube kit:', ...yt.map((w) => `  ${w}`));
  return lines.join('\n');
}
