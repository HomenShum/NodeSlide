import { digestJson } from './node-gym-task-core.mjs';

export const NODE_GYM_COMPILED_HARNESS_SCHEMA = 'nodekit.gym-compiled-harness/v1';

const PROFILE_CONTRACTS = {
  'light-director': {
    contextStrategy: 'brief-and-evidence',
    toolIds: ['select_artifact'],
    repairPolicy: 'escalate-on-semantic-failure',
    responseKind: 'story-plan',
    responseSchema: objectSchema(['narrativeThesis', 'storyBeats', 'artifactChoice'], {
      narrativeThesis: { type: 'string' },
      storyBeats: { type: 'array', minItems: 2, items: { type: 'string' } },
      artifactChoice: objectSchema(['kind', 'claimIds', 'sourceIds'], {
        kind: { type: 'string' },
        claimIds: stringArray(1),
        sourceIds: stringArray(1),
      }),
    }),
    repairSteps: [],
    failureAction: 'escalate-to-structured-planner',
  },
  'structured-planner': {
    contextStrategy: 'bounded-story-spec-and-reference-pack',
    toolIds: ['select_artifact', 'validate_artifact_spec'],
    repairPolicy: 'one-typed-repair',
    responseKind: 'story-spec',
    responseSchema: objectSchema(['story', 'artifactPlan'], {
      story: objectSchema(['thesis', 'beats'], {
        thesis: { type: 'string' },
        beats: { type: 'array', minItems: 2, items: { type: 'string' } },
      }),
      artifactPlan: objectSchema(['kind', 'claimIds', 'sourceIds', 'semanticChecks'], {
        kind: { type: 'string' },
        claimIds: stringArray(1),
        sourceIds: stringArray(1),
        semanticChecks: stringArray(1),
      }),
    }),
    repairSteps: ['validate_artifact_spec', 'repair_failed_fields_once'],
    failureAction: 'fail-closed',
  },
  'bounded-executor': {
    contextStrategy: 'one-task-one-schema-minimal-evidence',
    toolIds: ['compile_artifact', 'validate_artifact_spec'],
    repairPolicy: 'two-bounded-repairs',
    responseKind: 'artifact-spec',
    responseSchema: objectSchema(
      ['schemaVersion', 'id', 'kind', 'claimIds', 'sourceIds', 'payload'],
      {
        schemaVersion: { const: 'nodeslide.artifact-spec/v1' },
        id: { type: 'string' },
        kind: { type: 'string' },
        claimIds: stringArray(1),
        sourceIds: stringArray(1),
        payload: { type: 'object' },
      },
    ),
    repairSteps: [
      'validate_artifact_spec',
      'repair_schema_or_semantics',
      'validate_artifact_spec',
      'repair_render_contract',
    ],
    failureAction: 'fail-closed',
  },
  'repair-specialist': {
    contextStrategy: 'render-issue-and-source-spec',
    toolIds: ['validate_artifact_spec', 'apply_typed_repair'],
    repairPolicy: 'repair-only-no-regeneration',
    responseKind: 'typed-repair',
    responseSchema: objectSchema(['sourceSpecDigest', 'issueCode', 'patch'], {
      sourceSpecDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      issueCode: { type: 'string' },
      patch: { type: 'array', minItems: 1, items: { type: 'object' } },
    }),
    repairSteps: ['validate_source_spec', 'apply_typed_repair', 'validate_repaired_spec'],
    failureAction: 'fail-closed-no-regeneration',
  },
  'router-robustness': {
    contextStrategy: 'capability-probe-and-bounded-task',
    toolIds: ['record_returned_route', 'validate_artifact_spec'],
    repairPolicy: 'timeout-fallback-with-attribution',
    responseKind: 'route-attributed-artifact',
    responseSchema: objectSchema(['route', 'artifactSpec'], {
      route: objectSchema(
        ['requestedRoute', 'actualProvider', 'actualModel', 'attributionId', 'attributionIdKind'],
        {
          requestedRoute: { type: 'string' },
          actualProvider: { type: 'string' },
          actualModel: { type: 'string' },
          attributionId: { type: 'string' },
          attributionIdKind: { enum: ['provider-response', 'nodeslide-trace'] },
        },
      ),
      artifactSpec: { type: 'object' },
    }),
    repairSteps: ['record_returned_route', 'validate_artifact_spec'],
    failureAction: 'bounded-attributed-fallback-or-fail',
  },
};

/** Compiles a configuration label into an executable, immutable harness contract. */
export function compileExecutableNodeGymHarness({ plan, fixture, strictRuntime = true }) {
  const harness = plan?.harness;
  const contract = PROFILE_CONTRACTS[harness?.id];
  if (!contract) throw new Error(`Unknown NodeGym harness profile: ${harness?.id ?? '<missing>'}.`);
  assertConfiguredHarnessMatches(harness, contract);
  if (!fixture || fixture.taskId !== plan.task.id)
    throw new Error('Harness fixture does not match the immutable run plan.');
  if (harness.id === 'repair-specialist' && strictRuntime && !fixture.repairCase)
    throw new Error('Repair specialist requires a typed source spec and render issue fixture.');

  const runtimeContext = projectContext(harness.id, plan, fixture);
  const instructions = profileInstructions(harness.id, contract, fixture);
  const compiled = {
    schemaVersion: NODE_GYM_COMPILED_HARNESS_SCHEMA,
    profileId: harness.id,
    profileVersion: harness.version,
    responseKind: contract.responseKind,
    instructions,
    runtimeContext,
    responseSchema: contract.responseSchema,
    enabledTools: contract.toolIds.map((id) => toolContract(id)),
    repairWorkflow: {
      policy: contract.repairPolicy,
      maxAttempts: repairAttemptLimit(harness.id),
      steps: [...contract.repairSteps],
      onFailure: contract.failureAction,
    },
    routeContract: {
      requestedProvider: plan.model.provider,
      requestedRoute: plan.model.route,
      actualProviderRequired: plan.model.provider !== 'local',
      actualModelRequired: Boolean(plan.model.returnedModelRequired),
      attributionIdRequired: plan.model.provider !== 'local',
      aliasIsNotAttribution: plan.model.cohort === 'random-router',
    },
    persistence: {
      context:
        fixture.governance?.retention === 'ephemeral' ? 'memory-only' : 'receipt-digest-only',
      hiddenReasoning: 'never-persist',
      prompt: fixture.pool === 'public-development' ? 'digest-and-bounded-trace' : 'digest-only',
    },
  };
  return Object.freeze({
    ...compiled,
    contextDigest: digestJson(runtimeContext),
    harnessDigest: digestJson(compiled),
  });
}

export function validateExecutableHarnessProfiles(config) {
  const issues = [];
  const profiles = config?.harnesses ?? [];
  for (const id of Object.keys(PROFILE_CONTRACTS)) {
    const profile = profiles.find((entry) => entry.id === id);
    if (!profile) {
      issues.push(`${id}:missing`);
      continue;
    }
    try {
      assertConfiguredHarnessMatches(profile, PROFILE_CONTRACTS[id]);
    } catch (error) {
      issues.push(`${id}:${error.message}`);
    }
  }
  const behaviorDigests = profiles
    .filter((profile) => PROFILE_CONTRACTS[profile.id])
    .map((profile) => digestJson(PROFILE_CONTRACTS[profile.id]));
  if (new Set(behaviorDigests).size !== behaviorDigests.length)
    issues.push('harness_profiles_not_behaviorally_distinct');
  return { ok: issues.length === 0, issueCodes: issues };
}

function projectContext(profileId, plan, fixture) {
  const base = {
    taskId: fixture.taskId,
    taskClass: fixture.taskClass,
    brief: fixture.brief,
    artifactKind: fixture.reference.artifactKind,
  };
  if (profileId === 'light-director')
    return {
      ...base,
      claims: fixture.evidence.claims.map(({ id, text }) => ({ id, text })),
      sourceSummaries: fixture.evidence.sources.map(({ id, title }) => ({ id, title })),
    };
  if (profileId === 'structured-planner')
    return {
      ...base,
      claims: fixture.evidence.claims,
      sources: fixture.evidence.sources,
      reference: fixture.reference,
      constraints: fixture.constraints ?? {},
    };
  if (profileId === 'bounded-executor')
    return {
      ...base,
      claims: fixture.evidence.claims.map(({ id, text, sourceIds, numericFacts }) => ({
        id,
        text,
        sourceIds,
        numericFacts: numericFacts ?? [],
      })),
      sourceDigests: fixture.evidence.sources.map(({ id, digest }) => ({ id, digest })),
      schemaContract: fixture.reference.schemaContract ?? fixture.reference.validator,
      semanticAssertions: fixture.reference.semanticAssertions ?? [],
    };
  if (profileId === 'repair-specialist')
    return {
      ...base,
      sourceSpec: fixture.repairCase?.sourceSpec ?? null,
      sourceSpecDigest: fixture.repairCase?.sourceSpecDigest ?? null,
      renderIssue: fixture.repairCase?.renderIssue ?? null,
      immutableClaimIds: fixture.evidence.claims.map((claim) => claim.id),
      immutableSourceIds: fixture.evidence.sources.map((source) => source.id),
    };
  return {
    ...base,
    routeProbe: {
      requestedProvider: plan.model.provider,
      requestedRoute: plan.model.route,
      actualUpstreamRequired: plan.model.returnedModelRequired,
      timeoutMs: plan.budget.maxLatencyMs,
    },
    minimalClaims: fixture.evidence.claims.map(({ id, text, sourceIds }) => ({
      id,
      text,
      sourceIds,
    })),
    schemaContract: fixture.reference.schemaContract ?? fixture.reference.validator,
  };
}

function profileInstructions(profileId, contract, fixture) {
  const rules = [
    'Use only the supplied claims, sources, and numeric facts.',
    'Return only data conforming to the response schema.',
    'Do not expose hidden reasoning or invent provenance.',
  ];
  if (profileId === 'light-director')
    rules.push('Choose the story and dominant artifact; do not compile the artifact.');
  if (profileId === 'structured-planner')
    rules.push(
      'Plan typed semantics and perform exactly one field-scoped repair if validation fails.',
    );
  if (profileId === 'bounded-executor')
    rules.push('Compile one artifact and stop after two bounded typed repairs.');
  if (profileId === 'repair-specialist')
    rules.push('Patch the supplied spec only; never regenerate or change claim/source bindings.');
  if (profileId === 'router-robustness')
    rules.push(
      'Record the actual upstream provider/model and an auditable attribution ID before accepting output.',
    );
  rules.push(`Expected artifact kind: ${fixture.reference.artifactKind}.`);
  rules.push(`Failure action: ${contract.failureAction}.`);
  return rules;
}

function assertConfiguredHarnessMatches(harness, contract) {
  if (harness.contextStrategy !== contract.contextStrategy)
    throw new Error('configured context strategy differs from executable contract');
  if (harness.repairPolicy !== contract.repairPolicy)
    throw new Error('configured repair policy differs from executable contract');
  if (JSON.stringify(harness.toolIds) !== JSON.stringify(contract.toolIds))
    throw new Error('configured tools differ from executable contract');
}

function repairAttemptLimit(profileId) {
  if (profileId === 'structured-planner' || profileId === 'repair-specialist') return 1;
  if (profileId === 'bounded-executor') return 2;
  if (profileId === 'router-robustness') return 1;
  return 0;
}

function toolContract(id) {
  const contracts = {
    select_artifact: { id, effect: 'read-only-selection', input: ['brief', 'claims', 'sources'] },
    validate_artifact_spec: { id, effect: 'read-only-validation', input: ['artifactSpec'] },
    compile_artifact: {
      id,
      effect: 'bounded-construction',
      input: ['artifactKind', 'claims', 'schema'],
    },
    apply_typed_repair: {
      id,
      effect: 'field-scoped-mutation',
      input: ['sourceSpecDigest', 'patch'],
    },
    record_returned_route: {
      id,
      effect: 'receipt-attribution',
      input: [
        'requestedRoute',
        'actualProvider',
        'actualModel',
        'attributionId',
        'attributionIdKind',
      ],
    },
  };
  return contracts[id];
}

function objectSchema(required, properties) {
  return { type: 'object', additionalProperties: false, required, properties };
}

function stringArray(minItems = 0) {
  return { type: 'array', minItems, uniqueItems: true, items: { type: 'string' } };
}
