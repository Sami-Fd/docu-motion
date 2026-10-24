function tryParse(s: string): unknown | undefined {
  try {
    const v = JSON.parse(s);
    return v !== null && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Index one past the end of the balanced span starting at `start`, or -1. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** First parseable JSON object/array in `text`: fenced blocks first, then balanced spans in order. */
export function extractJson(text: string): unknown | undefined {
  for (const m of text.matchAll(/```[a-zA-Z0-9]*\s*\n?([\s\S]*?)```/g)) {
    const v = tryParse((m[1] ?? "").trim());
    if (v !== undefined) return v;
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    const end = balancedEnd(text, i);
    if (end < 0) continue;
    const v = tryParse(text.slice(i, end));
    if (v !== undefined) return v;
  }
  return undefined;
}
