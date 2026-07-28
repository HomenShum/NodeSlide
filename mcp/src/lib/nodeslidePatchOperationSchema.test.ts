import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nodeSlidePatchOperationSchema } from './nodeslideTools.js';

const source = readFileSync('src/lib/nodeslideTools.ts', 'utf8');

/**
 * Scenario: a local BYOK model is asked for a bounded edit. Models do three things here —
 * they get it right, they invent a field, and they invent an operation. Only the first may
 * reach Convex.
 */
describe('nodeSlidePatchOperationSchema', () => {
  it('accepts the operations the bounded planner is allowed to emit', () => {
    const accepted = [
      { op: 'move', slideId: 's1', elementId: 'e1', x: 0.2, y: 0.4 },
      { op: 'resize', slideId: 's1', elementId: 'e1', width: 0.5, height: 0.25 },
      { op: 'replace_text', slideId: 's1', elementId: 'e1', text: 'Revenue held flat' },
      {
        op: 'update_style',
        slideId: 's1',
        elementId: 'e1',
        properties: { fontSize: 28, textAlign: 'center' },
      },
      { op: 'reorder_slide', slideId: 's1', index: 2 },
      { op: 'update_slide', slideId: 's1', properties: { title: 'Q3' } },
    ];
    for (const operation of accepted) {
      expect(nodeSlidePatchOperationSchema.safeParse(operation).success).toBe(true);
    }
  });

  it('rejects a hallucinated extra field rather than forwarding it', () => {
    const result = nodeSlidePatchOperationSchema.safeParse({
      op: 'move',
      slideId: 's1',
      elementId: 'e1',
      x: 0.2,
      y: 0.4,
      // A model that decides geometry needs a unit. `.strict()` is the whole point.
      unit: 'percent',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invented operation and non-finite geometry', () => {
    expect(
      nodeSlidePatchOperationSchema.safeParse({ op: 'delete_deck', deckId: 'd1' }).success,
    ).toBe(false);
    expect(
      nodeSlidePatchOperationSchema.safeParse({
        op: 'move',
        slideId: 's1',
        elementId: 'e1',
        x: Number.POSITIVE_INFINITY,
        y: 0,
      }).success,
    ).toBe(false);
    expect(
      nodeSlidePatchOperationSchema.safeParse({ op: 'reorder_slide', slideId: 's1', index: -1 })
        .success,
    ).toBe(false);
  });

  /**
   * Wiring guard. The schema is only worth anything at the one place an unparsed array used
   * to cross into Convex; a version that exports it and keeps `Array.isArray` is a copy.
   */
  it('is the local BYOK planner gate, not an unused export', () => {
    expect(source).toContain('.array(nodeSlidePatchOperationSchema)');
    expect(source).toContain('.max(NODE_SLIDE_EXTERNAL_OPERATION_MAX)');
    expect(source).toContain('const operations = parsedOperations.data;');
    expect(source).not.toContain('Array.isArray(parsed?.operations)');
    expect(source).not.toContain('operations: unknown[]');
  });
});
