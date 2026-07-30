import { createHash } from 'node:crypto';
import { isRecipeSnapshot, isRecord, nonEmpty } from './schema';
import {
  type CompiledRecipe,
  RECIPELANG_MAX_ENTITIES,
  RECIPELANG_MAX_INPUT_BYTES,
  RECIPELANG_RECEIPT_VERSION,
  RECIPELANG_SCHEMA_VERSION,
  type RecipeCompiledArtifact,
  type RecipeCompiledStep,
  type RecipeDiagnostic,
  type RecipeRenderProfile,
  type RecipeSnapshot,
} from './types';

const MAX_READABLE_STAGES = 6;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function recipeHash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function normalizeRecipeSnapshot(value: unknown): RecipeSnapshot {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('RecipeLang normalization failed: input is not JSON-serializable.');
  }
  const inputBytes = new TextEncoder().encode(serialized).byteLength;
  if (inputBytes > RECIPELANG_MAX_INPUT_BYTES) {
    throw new Error(
      `RecipeLang input exceeds ${RECIPELANG_MAX_INPUT_BYTES} bytes (${inputBytes} received).`,
    );
  }
  if (!isRecipeSnapshot(value)) {
    throw new Error('RecipeLang normalization failed: expected recipelang/v1 Recipe.');
  }
  const snapshot = structuredClone(value);
  snapshot.meta.id = snapshot.meta.id.trim();
  snapshot.meta.title = snapshot.meta.title.trim();
  snapshot.meta.version = snapshot.meta.version ?? 0;
  snapshot.inputs = [...snapshot.inputs].map((input) => ({
    id: String(input.id).trim(),
    label: String(input.label).trim(),
    produces: String(input.produces).trim(),
  }));
  snapshot.artifacts = [...snapshot.artifacts].map((artifact) => ({
    id: String(artifact.id).trim(),
    shape: String(artifact.shape ?? '').trim(),
    ...(artifact.producer ? { producer: String(artifact.producer).trim() } : {}),
    consumers: [...(artifact.consumers ?? [])]
      .map(String)
      .map((item) => item.trim())
      .sort(),
    invariants: [...(artifact.invariants ?? [])]
      .map(String)
      .map((item) => item.trim())
      .sort(),
  }));
  snapshot.steps = [...snapshot.steps].map((step) => ({
    ...step,
    id: String(step.id).trim(),
    label: String(step.label).trim(),
    consumes: [...(step.consumes ?? [])]
      .map(String)
      .map((item) => item.trim())
      .sort(),
    produces: [...(step.produces ?? [])]
      .map(String)
      .map((item) => item.trim())
      .sort(),
  }));
  snapshot.outputs = [...snapshot.outputs].map((output) => ({
    artifact: String(output.artifact).trim(),
    label: String(output.label).trim(),
  }));
  snapshot.notes = [...(snapshot.notes ?? [])].map((note) => ({ ...note })).sort(byId);
  snapshot.render = {
    profile: snapshot.render?.profile ?? 'auto',
    allowedProfiles: [...(snapshot.render?.allowedProfiles ?? [])].sort(),
    direction: 'left-to-right',
    showContracts: snapshot.render?.showContracts ?? true,
    showExecutorBadges: snapshot.render?.showExecutorBadges ?? true,
    showNotes: snapshot.render?.showNotes ?? true,
  };
  snapshot.inputs.sort(byId);
  snapshot.artifacts.sort(byId);
  snapshot.steps.sort(byId);
  snapshot.outputs.sort((a, b) => a.artifact.localeCompare(b.artifact));
  return snapshot;
}

export function compileRecipe(
  value: unknown,
  requestedProfile?: RecipeRenderProfile,
): CompiledRecipe {
  let snapshot: RecipeSnapshot;
  try {
    snapshot = normalizeRecipeSnapshot(value);
  } catch (error) {
    const fallback = emptySnapshot();
    const message = error instanceof Error ? error.message : String(error);
    return failedCompilation(fallback, [
      {
        code: message.startsWith('RecipeLang input exceeds') ? 'bound_exceeded' : 'schema',
        severity: 'error',
        message,
      },
    ]);
  }
  const diagnostics = validateRecipeSnapshot(snapshot);
  const graph = buildGraph(snapshot);
  const topological = computeTopologicalStages(snapshot, graph, diagnostics);
  const provenanceByArtifact = computeProvenance(snapshot, topological.stageByStep, graph);
  const artifacts = snapshot.artifacts.map<RecipeCompiledArtifact>((artifact) => ({
    ...artifact,
    producer: graph.producerByArtifact.get(artifact.id) ?? '',
    consumers: [...(graph.consumersByArtifact.get(artifact.id) ?? [])].sort(),
    provenance: [...(provenanceByArtifact.get(artifact.id) ?? [])].sort(),
  }));
  const steps = snapshot.steps.map<RecipeCompiledStep>((step) => {
    const provenance = new Set<string>();
    for (const artifactId of step.consumes) {
      for (const inputId of provenanceByArtifact.get(artifactId) ?? []) provenance.add(inputId);
    }
    return {
      ...step,
      stage: topological.stageByStep.get(step.id) ?? 0,
      rowSpan: Math.max(1, provenance.size),
      provenance: [...provenance].sort(),
    };
  });
  const stages = steps.length ? Math.max(...steps.map((step) => step.stage)) + 1 : 0;
  const layoutOverflow = Math.max(0, stages - MAX_READABLE_STAGES);
  const inputIndex = new Map(snapshot.inputs.map((input, index) => [input.id, index]));
  const crossingCount = steps.filter((step) => {
    const indexes = step.provenance
      .map((inputId) => inputIndex.get(inputId))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => a - b);
    const first = indexes[0];
    const last = indexes.at(-1);
    return (
      indexes.length > 1 &&
      first !== undefined &&
      last !== undefined &&
      last - first + 1 !== indexes.length
    );
  }).length;
  const selected = selectProfile(snapshot, requestedProfile, topological.cycle, crossingCount);
  const snapshotHash = recipeHash(snapshot);
  return {
    snapshot,
    artifacts,
    steps,
    receipt: {
      schemaVersion: RECIPELANG_RECEIPT_VERSION,
      snapshotVersion: snapshot.meta.version ?? 0,
      snapshotHash,
      profile: selected.profile,
      contractErrors: diagnostics.filter((item) => item.severity === 'error').length,
      warnings: diagnostics.filter((item) => item.severity === 'warning').length,
      layoutOverflow,
      crossingCount,
      fallbackUsed: selected.fallbackUsed,
      stages,
      diagnostics,
    },
  };
}

export function validateRecipeSnapshot(snapshot: RecipeSnapshot): RecipeDiagnostic[] {
  const diagnostics: RecipeDiagnostic[] = [];
  const total =
    snapshot.inputs.length +
    snapshot.artifacts.length +
    snapshot.steps.length +
    snapshot.outputs.length +
    (snapshot.notes?.length ?? 0);
  if (total > RECIPELANG_MAX_ENTITIES) {
    diagnostics.push({
      code: 'bound_exceeded',
      severity: 'error',
      message: `Recipe contains ${total} entities; maximum is ${RECIPELANG_MAX_ENTITIES}.`,
    });
  }
  const ids = new Map<string, string>();
  for (const [kind, entities] of [
    ['input', snapshot.inputs],
    ['artifact', snapshot.artifacts],
    ['step', snapshot.steps],
    ['note', snapshot.notes ?? []],
  ] as const) {
    for (const entity of entities) {
      if (!nonEmpty(entity.id)) {
        diagnostics.push({ code: 'schema', severity: 'error', message: `${kind} id is required.` });
      } else if (ids.has(entity.id)) {
        diagnostics.push({
          code: 'duplicate_id',
          severity: 'error',
          entityId: entity.id,
          message: `${entity.id} is used by both ${ids.get(entity.id)} and ${kind}.`,
        });
      } else ids.set(entity.id, kind);
    }
  }
  const artifactIds = new Set(snapshot.artifacts.map((artifact) => artifact.id));
  const producers = new Map<string, string[]>();
  for (const input of snapshot.inputs) addProducer(producers, input.produces, input.id);
  for (const step of snapshot.steps) {
    for (const artifactId of step.consumes) {
      if (!artifactIds.has(artifactId)) missing(diagnostics, step.id, artifactId);
    }
    for (const artifactId of step.produces) {
      if (!artifactIds.has(artifactId)) missing(diagnostics, step.id, artifactId);
      addProducer(producers, artifactId, step.id);
    }
    if (step.executor.kind === 'code' && step.executor.deterministic !== true) {
      diagnostics.push({
        code: 'determinism_mismatch',
        severity: 'error',
        entityId: step.id,
        message: `Code step ${step.id} must declare deterministic: true.`,
      });
    }
    if (step.executor.kind === 'agent' && step.executor.deterministic !== false) {
      diagnostics.push({
        code: 'determinism_mismatch',
        severity: 'error',
        entityId: step.id,
        message: `Agent step ${step.id} must declare deterministic: false.`,
      });
    }
  }
  for (const artifact of snapshot.artifacts) {
    if (!nonEmpty(artifact.shape)) {
      diagnostics.push({
        code: 'shape_missing',
        severity: 'error',
        entityId: artifact.id,
        message: `Artifact ${artifact.id} has no declared shape.`,
      });
    }
    const declared = [...(producers.get(artifact.id) ?? [])];
    if (artifact.producer) declared.push(artifact.producer);
    if (new Set(declared).size > 1) {
      diagnostics.push({
        code: 'multiple_producers',
        severity: 'error',
        entityId: artifact.id,
        message: `Artifact ${artifact.id} has multiple canonical producers: ${[...new Set(declared)].sort().join(', ')}.`,
      });
    }
  }
  for (const output of snapshot.outputs) {
    if (!artifactIds.has(output.artifact)) missing(diagnostics, 'output', output.artifact);
    else if (
      !(
        producers.get(output.artifact)?.length ||
        snapshot.artifacts.find((a) => a.id === output.artifact)?.producer
      )
    ) {
      diagnostics.push({
        code: 'unreachable_output',
        severity: 'error',
        entityId: output.artifact,
        message: `Final output ${output.artifact} has no reachable producer.`,
      });
    }
  }
  return diagnostics;
}

function buildGraph(snapshot: RecipeSnapshot) {
  const producerByArtifact = new Map<string, string>();
  const consumersByArtifact = new Map<string, Set<string>>();
  for (const input of snapshot.inputs) producerByArtifact.set(input.produces, input.id);
  for (const artifact of snapshot.artifacts) {
    if (artifact.producer) producerByArtifact.set(artifact.id, artifact.producer);
    consumersByArtifact.set(artifact.id, new Set(artifact.consumers ?? []));
  }
  for (const step of snapshot.steps) {
    for (const artifactId of step.produces) producerByArtifact.set(artifactId, step.id);
    for (const artifactId of step.consumes) {
      const consumers = consumersByArtifact.get(artifactId) ?? new Set<string>();
      consumers.add(step.id);
      consumersByArtifact.set(artifactId, consumers);
    }
  }
  return { producerByArtifact, consumersByArtifact };
}

function computeTopologicalStages(
  snapshot: RecipeSnapshot,
  graph: ReturnType<typeof buildGraph>,
  diagnostics: RecipeDiagnostic[],
) {
  const stepIds = new Set(snapshot.steps.map((step) => step.id));
  const dependencies = new Map<string, Set<string>>();
  for (const step of snapshot.steps) {
    const deps = new Set<string>();
    for (const artifactId of step.consumes) {
      const producer = graph.producerByArtifact.get(artifactId);
      if (producer && stepIds.has(producer)) deps.add(producer);
    }
    dependencies.set(step.id, deps);
  }
  const stageByStep = new Map<string, number>();
  const remaining = new Set([...stepIds].sort());
  while (remaining.size) {
    const ready = [...remaining].filter((id) =>
      [...(dependencies.get(id) ?? [])].every((dependency) => stageByStep.has(dependency)),
    );
    if (!ready.length) {
      diagnostics.push({
        code: 'cycle',
        severity: 'error',
        message: `Recipe contains a cycle among: ${[...remaining].sort().join(', ')}.`,
      });
      return { stageByStep, cycle: true };
    }
    for (const id of ready.sort()) {
      const deps = [...(dependencies.get(id) ?? [])];
      stageByStep.set(
        id,
        deps.length
          ? Math.max(...deps.map((dependency) => stageByStep.get(dependency) ?? 0)) + 1
          : 0,
      );
      remaining.delete(id);
    }
  }
  return { stageByStep, cycle: false };
}

function computeProvenance(
  snapshot: RecipeSnapshot,
  stageByStep: Map<string, number>,
  graph: ReturnType<typeof buildGraph>,
) {
  const provenance = new Map<string, Set<string>>();
  for (const input of snapshot.inputs) provenance.set(input.produces, new Set([input.id]));
  const ordered = [...snapshot.steps].sort(
    (a, b) =>
      (stageByStep.get(a.id) ?? 0) - (stageByStep.get(b.id) ?? 0) || a.id.localeCompare(b.id),
  );
  for (const step of ordered) {
    const lineage = new Set<string>();
    for (const artifactId of step.consumes) {
      for (const inputId of provenance.get(artifactId) ?? []) lineage.add(inputId);
    }
    for (const artifactId of step.produces) provenance.set(artifactId, new Set(lineage));
  }
  for (const artifact of snapshot.artifacts) {
    if (!provenance.has(artifact.id)) {
      const producer = graph.producerByArtifact.get(artifact.id);
      provenance.set(
        artifact.id,
        producer && !stageByStep.has(producer) ? new Set([producer]) : new Set(),
      );
    }
  }
  return provenance;
}

function selectProfile(
  snapshot: RecipeSnapshot,
  requested: RecipeRenderProfile | undefined,
  cycle: boolean,
  crossingCount: number,
) {
  const preferred = requested ?? snapshot.render?.profile ?? 'auto';
  if (cycle && preferred !== 'contract-graph')
    return { profile: 'contract-graph' as const, fallbackUsed: true };
  if (crossingCount > 0 && (preferred === 'auto' || preferred === 'recipe-grid')) {
    return { profile: 'contract-graph' as const, fallbackUsed: true };
  }
  if (preferred !== 'auto') return { profile: preferred, fallbackUsed: false };
  const maxConsumes = Math.max(0, ...snapshot.steps.map((step) => step.consumes.length));
  return {
    profile: maxConsumes > 1 ? ('recipe-grid' as const) : ('pipeline' as const),
    fallbackUsed: false,
  };
}

function failedCompilation(
  snapshot: RecipeSnapshot,
  diagnostics: RecipeDiagnostic[],
): CompiledRecipe {
  return {
    snapshot,
    artifacts: [],
    steps: [],
    receipt: {
      schemaVersion: RECIPELANG_RECEIPT_VERSION,
      snapshotVersion: 0,
      snapshotHash: recipeHash(snapshot),
      profile: 'recipe-grid',
      contractErrors: diagnostics.length,
      warnings: 0,
      layoutOverflow: 0,
      crossingCount: 0,
      fallbackUsed: false,
      stages: 0,
      diagnostics,
    },
  };
}

function emptySnapshot(): RecipeSnapshot {
  return {
    schemaVersion: RECIPELANG_SCHEMA_VERSION,
    kind: 'Recipe',
    meta: { id: 'invalid', title: 'Invalid recipe', version: 0 },
    inputs: [],
    artifacts: [],
    steps: [],
    outputs: [],
  };
}

function addProducer(map: Map<string, string[]>, artifactId: string, producerId: string) {
  map.set(artifactId, [...(map.get(artifactId) ?? []), producerId]);
}

function missing(diagnostics: RecipeDiagnostic[], entityId: string, artifactId: string) {
  diagnostics.push({
    code: 'missing_artifact',
    severity: 'error',
    entityId,
    message: `${entityId} references undeclared artifact ${artifactId}.`,
  });
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}
