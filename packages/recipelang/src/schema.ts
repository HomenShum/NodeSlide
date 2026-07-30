import type { RecipeSnapshot } from './types';

export const recipeLangJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://nodeslide.vercel.app/schemas/recipelang-v1.json',
  title: 'RecipeLang v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'kind', 'meta', 'inputs', 'artifacts', 'steps', 'outputs'],
  properties: {
    schemaVersion: { const: 'recipelang/v1' },
    kind: { const: 'Recipe' },
    meta: {
      type: 'object',
      required: ['id', 'title'],
      properties: {
        id: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        version: { type: 'integer', minimum: 0 },
      },
    },
    inputs: { type: 'array', maxItems: 2000 },
    artifacts: { type: 'array', maxItems: 2000 },
    steps: { type: 'array', maxItems: 2000 },
    outputs: { type: 'array', maxItems: 2000 },
    notes: { type: 'array', maxItems: 2000 },
    render: { type: 'object' },
  },
} as const;

export function isRecipeSnapshot(value: unknown): value is RecipeSnapshot {
  if (
    !isRecord(value) ||
    value['schemaVersion'] !== 'recipelang/v1' ||
    value['kind'] !== 'Recipe'
  ) {
    return false;
  }
  const meta = value['meta'];
  if (!isRecord(meta) || !nonEmpty(meta['id']) || !nonEmpty(meta['title'])) return false;
  return ['inputs', 'artifacts', 'steps', 'outputs'].every((key) => Array.isArray(value[key]));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
