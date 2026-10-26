import {zodSchema} from 'ai';
import {describe, expect, it} from 'vitest';
import {ThumbnailSpecSchema} from '@docu-motion/scenes';

// What the LLM sees: the JSON Schema derived from the Zod schema.
describe('ThumbnailSpecSchema as JSON Schema', () => {
  const schema = zodSchema(ThumbnailSpecSchema).jsonSchema as {properties: Record<string, any>};
  it('carries the limits of words and figure', () => {
    expect(schema.properties.words.items.maxLength).toBe(28);
    expect(schema.properties.words.items.description).toMatch(/1.*14 characters/);
    expect(schema.properties.figure.maxLength).toBe(24);
    expect(schema.properties.figure.description).toMatch(/12 characters/);
  });
  it('describes the highlight rule', () => {
    expect(schema.properties.highlight.description).toMatch(/index.*words/i);
  });
});
