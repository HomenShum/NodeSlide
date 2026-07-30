export const RECIPELANG_SCHEMA_VERSION = 'recipelang/v1' as const;
export const RECIPELANG_RECEIPT_VERSION = 'recipelang.receipt/v1' as const;
export const RECIPELANG_PATCH_VERSION = 'recipelang.patch/v1' as const;
export const RECIPELANG_MAX_ENTITIES = 2_000;
export const RECIPELANG_MAX_INPUT_BYTES = 4 * 1024 * 1024;

export type RecipeRenderProfile =
  | 'auto'
  | 'recipe-grid'
  | 'pipeline'
  | 'swimlane'
  | 'contract-graph';

export interface RecipeMeta {
  id: string;
  title: string;
  description?: string;
  version?: number;
}

export interface RecipeInput {
  id: string;
  label: string;
  produces: string;
}

export interface RecipeArtifact {
  id: string;
  shape: string;
  producer?: string;
  consumers?: string[];
  invariants?: string[];
}

export type RecipeExecutor =
  | { kind: 'code'; runtime?: string; ref?: string; deterministic: true }
  | { kind: 'agent'; capability?: string; deterministic: false }
  | { kind: 'human'; role?: string }
  | { kind: 'tool'; toolName: string }
  | { kind: 'wait'; condition: string };

export interface RecipeStep {
  id: string;
  label: string;
  consumes: string[];
  produces: string[];
  executor: RecipeExecutor;
  lane?: string;
}

export interface RecipeOutput {
  artifact: string;
  label: string;
}

export interface RecipeNote {
  id: string;
  anchor: string;
  kind: 'info' | 'warning' | 'decision';
  body: string;
}

export interface RecipeRenderPreferences {
  profile: RecipeRenderProfile;
  allowedProfiles?: RecipeRenderProfile[];
  direction?: 'left-to-right';
  showContracts?: boolean;
  showExecutorBadges?: boolean;
  showNotes?: boolean;
}

export interface RecipeSnapshot {
  schemaVersion: typeof RECIPELANG_SCHEMA_VERSION;
  kind: 'Recipe';
  meta: RecipeMeta;
  inputs: RecipeInput[];
  artifacts: RecipeArtifact[];
  steps: RecipeStep[];
  outputs: RecipeOutput[];
  notes?: RecipeNote[];
  render?: RecipeRenderPreferences;
}

export interface RecipeDiagnostic {
  code:
    | 'schema'
    | 'duplicate_id'
    | 'missing_artifact'
    | 'multiple_producers'
    | 'shape_missing'
    | 'unreachable_output'
    | 'cycle'
    | 'determinism_mismatch'
    | 'cas_conflict'
    | 'operation_invalid'
    | 'bound_exceeded';
  severity: 'error' | 'warning';
  message: string;
  entityId?: string;
}

export interface RecipeCompiledArtifact extends RecipeArtifact {
  producer: string;
  consumers: string[];
  provenance: string[];
}

export interface RecipeCompiledStep extends RecipeStep {
  stage: number;
  rowSpan: number;
  provenance: string[];
}

export interface RecipeReceipt {
  schemaVersion: typeof RECIPELANG_RECEIPT_VERSION;
  snapshotVersion: number;
  snapshotHash: `sha256:${string}`;
  profile: RecipeRenderProfile;
  contractErrors: number;
  warnings: number;
  layoutOverflow: number;
  crossingCount: number;
  fallbackUsed: boolean;
  stages: number;
  diagnostics: RecipeDiagnostic[];
}

export interface RecipeGridAlignmentReceipt {
  schemaVersion: 'recipelang.alignment/v1';
  reference: 'cooking-for-engineers-trn';
  passed: boolean;
  checks: {
    contiguousColumns: boolean;
    leftToRight: boolean;
    mergedSpanIntegrity: boolean;
    outputConvergence: boolean;
    rowBoundaryAlignment: boolean;
  };
  issues: string[];
}

export interface CompiledRecipe {
  snapshot: RecipeSnapshot;
  artifacts: RecipeCompiledArtifact[];
  steps: RecipeCompiledStep[];
  receipt: RecipeReceipt;
}

export type RecipePatchOperation =
  | { op: 'input.add'; input: RecipeInput }
  | { op: 'artifact.add'; artifact: RecipeArtifact }
  | { op: 'artifact.setShape'; artifactId: string; shape: string }
  | { op: 'step.add'; step: RecipeStep }
  | { op: 'step.bindInput'; stepId: string; artifactId: string }
  | { op: 'step.bindOutput'; stepId: string; artifactId: string }
  | { op: 'step.update'; stepId: string; patch: Partial<RecipeStep> }
  | { op: 'note.add'; note: RecipeNote }
  | { op: 'render.setProfile'; profile: RecipeRenderProfile }
  | { op: 'entity.remove'; entityId: string };

export interface RecipePatch {
  schemaVersion: typeof RECIPELANG_PATCH_VERSION;
  commandId: string;
  idempotencyKey: string;
  baseVersion: number;
  operations: RecipePatchOperation[];
}

export interface RecipePatchReceipt {
  commandId: string;
  idempotencyKey: string;
  baseVersion: number;
  resultingVersion: number;
  beforeHash: `sha256:${string}`;
  afterHash: `sha256:${string}`;
  applied: boolean;
}

export interface RecipeGridSlideElement {
  type: 'recipe-grid';
  id: string;
  recipeSnapshotId: string;
  snapshot: RecipeSnapshot;
  view: {
    profile: 'recipe-grid';
    stageRange?: [number, number];
    showContracts: boolean;
    showExecutorBadges: boolean;
    showNotes: boolean;
  };
  receipt: RecipeReceipt;
}

export interface NodeSlideRecipePrimitive {
  id: string;
  kind: 'text' | 'shape' | 'connector';
  role: string;
  content?: string;
  bbox: { x: number; y: number; width: number; height: number };
  metadata: {
    recipeSnapshotId: string;
    entityId: string;
    entityKind: 'input' | 'artifact' | 'step' | 'output' | 'note';
    contentHash: `sha256:${string}`;
  };
}
