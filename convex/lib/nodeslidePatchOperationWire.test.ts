import { describe, expect, it } from 'vitest';
import { NODESLIDE_PATCH_OPERATION_OPS } from '../../shared/nodeslide';
import { nodeslidePatchOperationValidator } from './nodeslideValidators';

/**
 * The persistence boundary, guarded.
 *
 * `nodeslidePatchOperationValidator` enumerates every `PatchOperation` member as a
 * `v.literal`. Nothing in the type system links the two: a new member can be added
 * to the `PatchOperation` union, satisfy both compilers and every UI narrowing site,
 * and still be rejected by Convex at the wire because its literal was never added
 * here. That is a green-compile / wrong-runtime failure — the operation looks
 * shipped and is not.
 *
 * `convex/tsconfig.json` excludes `**\/*.test.ts` and the root tsconfig does not
 * include `convex/`, so this file is checked by NEITHER compiler. It only protects
 * anything because vitest actually runs it.
 */
describe('Convex patch-operation wire validator', () => {
  function validatorOps(): string[] {
    const union = nodeslidePatchOperationValidator as unknown as {
      kind: string;
      members: readonly {
        kind: string;
        fields: Record<string, { kind: string; value?: unknown }>;
      }[];
    };
    expect(union.kind).toBe('union');
    return union.members.map((member, index) => {
      expect(member.kind).toBe('object');
      const op = member.fields.op;
      if (!op || op.kind !== 'literal' || typeof op.value !== 'string') {
        throw new Error(`Union member ${index} does not pin a literal op.`);
      }
      return op.value;
    });
  }

  it('enumerates exactly the ops in the PatchOperation union — no more, no fewer', () => {
    expect([...validatorOps()].sort()).toEqual([...NODESLIDE_PATCH_OPERATION_OPS].sort());
  });

  it('accepts update_theme_v1 with a partial mode, colors, and typography payload', () => {
    const ops = validatorOps();
    expect(ops).toContain('update_theme_v1');

    const union = nodeslidePatchOperationValidator as unknown as {
      members: readonly {
        fields: Record<string, { kind: string; value?: unknown; fields?: Record<string, unknown> }>;
      }[];
    };
    const themeMember = union.members.find(
      (member) => member.fields.op?.value === 'update_theme_v1',
    );
    if (!themeMember) throw new Error('update_theme_v1 is missing from the wire validator.');

    // A theme op carries no slideId; a validator that demanded one would reject
    // every well-formed theme patch at the wire.
    expect(Object.keys(themeMember.fields).sort()).toEqual(['op', 'properties']);
    const properties = themeMember.fields.properties as unknown as {
      kind: string;
      fields: Record<string, unknown>;
    };
    expect(properties.kind).toBe('object');
    expect(Object.keys(properties.fields).sort()).toEqual(['colors', 'mode', 'typography']);
  });
});
