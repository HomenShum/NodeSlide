import { compileRecipe, recipeHash } from './compiler';
import {
  RECIPELANG_PATCH_VERSION,
  type RecipePatch,
  type RecipePatchReceipt,
  type RecipeSnapshot,
} from './types';

export function applyRecipePatch(
  snapshot: RecipeSnapshot,
  patch: RecipePatch,
  priorReceipts: readonly RecipePatchReceipt[] = [],
): { snapshot: RecipeSnapshot; receipt: RecipePatchReceipt } {
  if (patch.schemaVersion !== RECIPELANG_PATCH_VERSION)
    throw new Error('Unsupported RecipeLang patch.');
  const currentVersion = snapshot.meta.version ?? 0;
  const previous = priorReceipts.find((receipt) => receipt.idempotencyKey === patch.idempotencyKey);
  if (previous) {
    const currentHash = recipeHash(snapshot);
    const matchesKnownState =
      previous.beforeHash === currentHash || previous.afterHash === currentHash;
    if (previous.commandId !== patch.commandId || !matchesKnownState) {
      throw new Error(`Idempotency key ${patch.idempotencyKey} was reused with different input.`);
    }
    return { snapshot: structuredClone(snapshot), receipt: { ...previous, applied: false } };
  }
  if (patch.baseVersion !== currentVersion) {
    throw new Error(
      `CAS conflict: expected version ${patch.baseVersion}, current version is ${currentVersion}.`,
    );
  }
  const next = structuredClone(snapshot);
  for (const operation of patch.operations) {
    if (operation.op === 'input.add') next.inputs.push(operation.input);
    else if (operation.op === 'artifact.add') next.artifacts.push(operation.artifact);
    else if (operation.op === 'artifact.setShape') {
      requireEntity(next.artifacts, operation.artifactId, 'artifact').shape = operation.shape;
    } else if (operation.op === 'step.add') next.steps.push(operation.step);
    else if (operation.op === 'step.bindInput') {
      const step = requireEntity(next.steps, operation.stepId, 'step');
      step.consumes = unique([...step.consumes, operation.artifactId]);
    } else if (operation.op === 'step.bindOutput') {
      const step = requireEntity(next.steps, operation.stepId, 'step');
      step.produces = unique([...step.produces, operation.artifactId]);
    } else if (operation.op === 'step.update') {
      const step = requireEntity(next.steps, operation.stepId, 'step');
      Object.assign(step, operation.patch, { id: step.id });
    } else if (operation.op === 'note.add') {
      next.notes = [...(next.notes ?? []), operation.note];
    } else if (operation.op === 'render.setProfile') {
      next.render = {
        ...(next.render ?? { profile: operation.profile }),
        profile: operation.profile,
      };
    } else {
      removeEntity(next, operation.entityId);
    }
  }
  next.meta.version = currentVersion + 1;
  const compiled = compileRecipe(next);
  if (compiled.receipt.contractErrors) {
    throw new Error(
      `Patch violates RecipeLang contracts: ${compiled.receipt.diagnostics
        .filter((item) => item.severity === 'error')
        .map((item) => item.message)
        .join(' ')}`,
    );
  }
  const receipt: RecipePatchReceipt = {
    commandId: patch.commandId,
    idempotencyKey: patch.idempotencyKey,
    baseVersion: currentVersion,
    resultingVersion: currentVersion + 1,
    beforeHash: recipeHash(snapshot),
    afterHash: recipeHash(compiled.snapshot),
    applied: true,
  };
  return { snapshot: compiled.snapshot, receipt };
}

function requireEntity<T extends { id: string }>(items: T[], id: string, kind: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown ${kind} ${id}.`);
  return item;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function removeEntity(snapshot: RecipeSnapshot, id: string) {
  snapshot.inputs = snapshot.inputs.filter((item) => item.id !== id);
  snapshot.artifacts = snapshot.artifacts.filter((item) => item.id !== id);
  snapshot.steps = snapshot.steps.filter((item) => item.id !== id);
  const notes = snapshot.notes?.filter((item) => item.id !== id);
  if (notes?.length) snapshot.notes = notes;
  else Reflect.deleteProperty(snapshot, 'notes');
  snapshot.outputs = snapshot.outputs.filter((item) => item.artifact !== id);
}
