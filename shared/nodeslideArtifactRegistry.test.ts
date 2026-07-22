import { describe, expect, it } from 'vitest';
import { canonicalArtifactFixture } from './nodeslideArtifactRegistry.fixtures';
import {
  NODESLIDE_ARTIFACT_COMPILER_REGISTRY,
  NODESLIDE_CANONICAL_ARTIFACT_KINDS,
  isSafeNodeSlideArtifactSourceUrl,
  normalizeNodeSlideCanonicalArtifactSpec,
  validateNodeSlideCanonicalArtifactSpec,
} from './nodeslideArtifactRegistry.js';
import externalSchema from './nodeslideArtifactSpec.schema.json';

describe('canonical ArtifactSpec runtime registry', () => {
  it('rejects credential-bearing and signed evidence URLs without blocking safe HTTPS state', () => {
    expect(
      isSafeNodeSlideArtifactSourceUrl('https://evidence.example.com/capture.png?page=2#crop'),
    ).toBe(true);
    expect(
      isSafeNodeSlideArtifactSourceUrl(
        'https://evidence.example.com/capture.png?label=Quarter%25201&page=2#section-2',
      ),
    ).toBe(true);
    for (const unsafeUrl of [
      'https://evidence.example.com/capture.png?api_key=do-not-persist',
      'https://evidence.example.com/capture.png?access_token=do-not-persist',
      'https://evidence.example.com/capture.png?X-Amz-Credential=scope&X-Amz-Signature=abc',
      'https://evidence.example.com/capture.png?sig=azure-signature',
      'https://evidence.example.com/capture.png#token=fragment-secret',
      'https://evidence.example.com/capture.png?next=token%3Dnested-secret',
      'https://evidence.example.com/capture.png?state=Bearer%20credential',
      `https://evidence.example.com/capture.png?context=${'a'.repeat(40)}`,
      'https://evidence.example.com/capture.png#github_pat_secret-value',
      'https://evidence.example.com/capture.png#eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature123',
      'https://evidence.example.com/capture.png?next=token%253Dsecret',
      'https://evidence.example.com/capture.png?next=https%253A%252F%252Fidentity.example.com%252Fcallback%253Faccess_token%253Dsecret',
      'https://evidence.example.com/capture.png?api%255Fkey=secret',
      'https://evidence.example.com/capture.png#token%253Dsecret',
      'https://evidence.example.com/capture.png?next=%E0%A4%A',
      'https://evidence.example.com/capture.png?next=%252525252525746f6b656e%2525252525253Dsecret',
      'https://[::]/capture.png',
      'https://[::1]/capture.png',
      'https://[::ffff:127.0.0.1]/capture.png',
      'https://[::ffff:10.0.0.1]/capture.png',
      'https://[fe80::1]/capture.png',
      'https://[febf::1]/capture.png',
      'https://[fec0::1]/capture.png',
      'https://[ff02::1]/capture.png',
    ]) {
      expect(isSafeNodeSlideArtifactSourceUrl(unsafeUrl), unsafeUrl).toBe(false);
    }
    expect(isSafeNodeSlideArtifactSourceUrl('https://[2606:4700:4700::1111]/capture.png')).toBe(
      true,
    );
  });

  it('validates all 16 discriminated families with a compiler declaration', () => {
    for (const kind of NODESLIDE_CANONICAL_ARTIFACT_KINDS) {
      expect(validateNodeSlideCanonicalArtifactSpec(canonicalArtifactFixture(kind))).toMatchObject({
        ok: true,
        kind,
      });
      expect(NODESLIDE_ARTIFACT_COMPILER_REGISTRY[kind]).toMatchObject({
        primitive: expect.any(String),
        mode: expect.stringMatching(/native|adapter|fallback/u),
        browserContract: expect.any(String),
        pptxContract: expect.any(String),
      });
    }
  });

  it('keeps the checked-in JSON Schema discriminators aligned with the runtime registry', () => {
    const schemaKinds = externalSchema.oneOf.map((entry) => entry.$ref.split('/').at(-1));
    expect(schemaKinds).toEqual(NODESLIDE_CANONICAL_ARTIFACT_KINDS);
    expect(externalSchema.$id).toContain('nodeslide.artifact-spec.v1');
  });

  it('fails unknown versions, kinds, promoted truth, mismatched sources, and unknown refs', () => {
    const base = canonicalArtifactFixture('chart');
    const cases = [
      { ...base, schemaVersion: 'nodeslide.artifact-spec/v99' },
      { ...base, kind: 'radar' },
      {
        ...base,
        provenance: { ...base.provenance, truthState: 'promoted' },
      },
      { ...base, sourceIds: ['brief:success-criteria'] },
    ];
    expect(
      cases.map((candidate) =>
        validateNodeSlideCanonicalArtifactSpec(candidate).issues.map((issue) => issue.code),
      ),
    ).toEqual([
      expect.arrayContaining(['artifact_schema_version']),
      expect.arrayContaining(['artifact_kind']),
      expect.arrayContaining(['artifact_provenance_truth_state']),
      expect.arrayContaining(['artifact_source_binding']),
    ]);
    expect(
      validateNodeSlideCanonicalArtifactSpec(base, {
        allowedSourceRefs: ['brief:success-criteria'],
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'artifact_source_binding',
          path: '$.provenance.sourceRefs[0]',
        }),
      ]),
    );
  });

  it('normalizes deterministically without trusting a supplied digest', () => {
    const value = {
      ...canonicalArtifactFixture('waterfall'),
      specDigest: `sha256:${'f'.repeat(64)}`,
    };
    const first = normalizeNodeSlideCanonicalArtifactSpec(value);
    const second = normalizeNodeSlideCanonicalArtifactSpec(value);
    expect(first).toEqual(second);
    expect(first.spec).not.toHaveProperty('specDigest');
    expect(first.spec).toMatchObject({
      schemaVersion: 'nodeslide.artifact-spec/v1',
      sourceIds: ['brief:prompt'],
      provenance: {
        truthState: 'derived',
        sourceRefs: ['brief:prompt'],
      },
    });
  });

  it('enforces evidence classes and exact claim/source URL bindings', () => {
    const safeUrl = 'https://evidence.example.com/capture.png';
    const base = {
      ...canonicalArtifactFixture('evidence-media'),
      claimIds: ['claim:evidence'],
      sourceIds: ['link:1'],
      provenance: {
        truthState: 'derived',
        rationale: 'The supplied link identifies this evidence capture.',
        sourceRefs: ['link:1'],
      },
      payload: {
        ...canonicalArtifactFixture('evidence-media').payload,
        claimId: 'claim:evidence',
        sourceUrl: safeUrl,
      },
    };
    const options = {
      allowedSourceRefs: ['link:1'],
      allowedTruthStatesBySourceRef: {
        'link:1': ['derived', 'illustrative', 'missing', 'not-run'] as const,
      },
      allowedSourceUrlsBySourceRef: { 'link:1': safeUrl },
    };

    expect(validateNodeSlideCanonicalArtifactSpec(base, options).ok).toBe(true);
    expect(
      validateNodeSlideCanonicalArtifactSpec({ ...base, claimIds: ['claim:other'] }, options)
        .issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'evidence_claim_unbound' })]),
    );
    expect(
      validateNodeSlideCanonicalArtifactSpec(
        {
          ...base,
          payload: { ...base.payload, sourceUrl: 'https://tracker.example.net/pixel.png' },
        },
        options,
      ).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'evidence_source_url_unbound' })]),
    );
    expect(
      validateNodeSlideCanonicalArtifactSpec(
        {
          ...base,
          provenance: { ...base.provenance, truthState: 'observed' },
        },
        options,
      ).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'artifact_provenance_evidence_class' }),
      ]),
    );
  });

  it('requires measured runtime receipts to have exact authorized SHA-256 lineage', () => {
    const receiptDigest = `sha256:${'b'.repeat(64)}`;
    const runtime = {
      ...canonicalArtifactFixture('runtime-proof'),
      sourceIds: ['receipt:runtime:1'],
      provenance: {
        truthState: 'observed',
        rationale: 'The cited runtime receipt contains the repeated samples.',
        sourceRefs: ['receipt:runtime:1'],
      },
      payload: { sampleSize: 3, unit: 'ms', status: 'observed', receiptDigest },
    };
    const options = {
      allowedSourceRefs: ['receipt:runtime:1'],
      allowedTruthStatesBySourceRef: {
        'receipt:runtime:1': ['observed', 'derived'] as const,
      },
      allowedReceiptDigestsBySourceRef: { 'receipt:runtime:1': [receiptDigest] },
    };

    expect(validateNodeSlideCanonicalArtifactSpec(runtime, options).ok).toBe(true);
    expect(
      validateNodeSlideCanonicalArtifactSpec(
        { ...runtime, payload: { ...runtime.payload, receiptDigest: 'made-up' } },
        options,
      ).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'runtime_receipt_unbound' }),
        expect.objectContaining({ code: 'runtime_receipt_lineage' }),
      ]),
    );
    expect(
      validateNodeSlideCanonicalArtifactSpec(
        {
          ...runtime,
          payload: { ...runtime.payload, receiptDigest: `sha256:${'c'.repeat(64)}` },
        },
        options,
      ).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'runtime_receipt_lineage' })]),
    );
  });

  it('integrates stable semantic-depth issues while preserving explicit missing chart values', () => {
    const chart = canonicalArtifactFixture('chart');
    const explicitMissing = {
      ...chart,
      payload: {
        ...chart.payload,
        missingValuePolicy: 'Render a labeled gap; do not impute.',
        series: [
          {
            id: 'activation',
            values: [42, null],
            uncertainty: { lower: [40, null], upper: [44, null] },
          },
        ],
      },
    };
    expect(validateNodeSlideCanonicalArtifactSpec(explicitMissing).ok).toBe(true);
    expect(
      validateNodeSlideCanonicalArtifactSpec({
        ...explicitMissing,
        payload: { ...explicitMissing.payload, missingValuePolicy: undefined },
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'chart_missing_value_policy_missing' }),
      ]),
    );
  });
});
