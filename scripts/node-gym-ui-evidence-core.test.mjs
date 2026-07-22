import { describe, expect, it } from 'vitest';
import { buildNodeGymUiEvidenceEnvelope } from './lib/node-gym-ui-evidence-core.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const file = (name, character, sourceRunDigest = digest('9')) => ({
  path: name,
  digest: digest(character),
  bytes: 128,
  sourceRunDigest,
  validation: { status: 'passed' },
});

function completeEnvelope() {
  return {
    sourceRunDigest: digest('9'),
    expectedArtifactKind: 'chart',
    normalizedSpecSetDigest: digest('a'),
    normalizedSpecs: [
      {
        schemaVersion: 'nodeslide.artifact-spec/v1',
        id: 'chart-1',
        kind: 'chart',
        claimIds: ['claim:1'],
        sourceIds: ['source:1'],
        specSetDigest: digest('a'),
        artifactHandle: digest('b'),
        bindingDigest: digest('4'),
      },
    ],
    requiredClaimIds: ['claim:1'],
    resolvedClaimIds: ['claim:1'],
    requiredFactIds: ['fact:1'],
    resolvedFactIds: ['fact:1'],
    slides: [
      {
        slideNumber: 1,
        browser: file('browser-slides/slide-1.png', 'c'),
        pptxRender: file('pptx-rendered/slide-1.png', 'd'),
        pdfPage: file('pdf-pages/slide-1.jpg', 'e'),
        claimIds: ['claim:1'],
        sourceIds: ['source:1'],
        specSetDigest: digest('a'),
      },
    ],
    montage: file('montage.png', 'f'),
    sourceLineage: [
      {
        sourceId: 'source:1',
        digest: digest('1'),
        claimIds: ['claim:1'],
        slideNumbers: [1],
      },
    ],
    harnessObservation: {
      harnessDigest: digest('2'),
      traceDigest: digest('5'),
      expectedEffects: ['schema-injected', 'repair-applied'],
      observedEffects: ['schema-injected', 'repair-applied'],
    },
    retention: {
      status: 'passed',
      retentionSafe: true,
      remainingDeckRows: 0,
      remainingSourceRows: 0,
      receiptDigest: digest('3'),
    },
  };
}

describe('NodeGym UI evidence envelope', () => {
  it('passes only a complete spec/claim/fact/cross-format/harness/cleanup envelope', () => {
    const receipt = buildNodeGymUiEvidenceEnvelope(completeEnvelope());
    expect(receipt).toMatchObject({
      schemaVersion: 'nodekit.gym-ui-evidence-envelope/v1',
      status: 'passed',
      issueCodes: [],
      harnessObservation: { observed: true },
      retention: { retentionSafe: true },
    });
  });

  it('fails closed for every omitted evidence family', () => {
    const receipt = buildNodeGymUiEvidenceEnvelope({
      ...completeEnvelope(),
      normalizedSpecs: [],
      resolvedClaimIds: [],
      resolvedFactIds: [],
      slides: [],
      montage: null,
      sourceLineage: [],
      harnessObservation: {
        harnessDigest: digest('2'),
        expectedEffects: ['repair-applied'],
        observedEffects: [],
      },
      retention: { status: 'failed', retentionSafe: false },
    });
    expect(receipt.status).toBe('failed');
    expect(receipt.issueCodes).toEqual(
      expect.arrayContaining([
        'normalized_artifact_spec_missing',
        'required_claim_binding_missing',
        'required_fact_binding_missing',
        'per_slide_evidence_missing',
        'montage_evidence_invalid',
        'source_lineage_missing',
        'harness_effect_not_observed',
        'retention_cleanup_unverified',
      ]),
    );
  });

  it('rejects placeholder file metadata, wrong run lineage, and absolute paths', () => {
    const receipt = buildNodeGymUiEvidenceEnvelope({
      ...completeEnvelope(),
      slides: [
        {
          ...completeEnvelope().slides[0],
          browser: {
            ...completeEnvelope().slides[0].browser,
            path: 'C:\\secret\\editor.png',
            bytes: 0,
          },
          pdfPage: {
            ...completeEnvelope().slides[0].pdfPage,
            sourceRunDigest: digest('8'),
          },
        },
      ],
    });
    expect(receipt.status).toBe('failed');
    expect(receipt.issueCodes).toEqual(
      expect.arrayContaining(['browser_slide_evidence_invalid', 'pdf_page_evidence_invalid']),
    );
    expect(receipt.slides[0].browser).toMatchObject({ path: null, bytes: 0 });
  });

  it('does not accept aggregate shadow metadata without a typed kind and binding handle', () => {
    const receipt = buildNodeGymUiEvidenceEnvelope({
      ...completeEnvelope(),
      expectedArtifactKind: 'waterfall',
      normalizedSpecs: [
        {
          ...completeEnvelope().normalizedSpecs[0],
          artifactHandle: null,
        },
      ],
    });
    expect(receipt.status).toBe('failed');
    expect(receipt.issueCodes).toEqual(
      expect.arrayContaining([
        'normalized_artifact_spec_invalid',
        'expected_artifact_kind_not_observed',
      ]),
    );
  });
});
