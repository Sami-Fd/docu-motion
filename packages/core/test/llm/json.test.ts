import {describe, expect, it} from 'vitest';
import {extractJson} from '../../src/llm/json.js';

describe('extractJson', () => {
  it('reads a fenced block', () => {
    expect(extractJson('Here: ```json\n{"a":1}\n``` thanks')).toEqual({a: 1});
  });
  it('takes the first of several objects', () => {
    expect(extractJson('x {"a":1} y {"b":2}')).toEqual({a: 1});
  });
  it('reads arrays', () => {
    expect(extractJson('[1,2]')).toEqual([1, 2]);
  });
  it('returns undefined without JSON', () => {
    expect(extractJson('no json')).toBeUndefined();
  });
  it('ignores braces inside strings', () => {
    expect(extractJson('{"a": "}"}')).toEqual({a: '}'});
  });
  it('skips an invalid fence and falls back to later spans', () => {
    expect(extractJson('```\nnot json\n``` then {"ok":true}')).toEqual({ok: true});
  });
});
