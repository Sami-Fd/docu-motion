/** Replaces every secret of 8+ characters with `***`. */
export function redact(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join('***');
  }
  return out;
}
