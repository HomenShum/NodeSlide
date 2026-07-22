export const NODESLIDE_ARTIFACT_CATEGORIES = [
  'narrative',
  'data',
  'systems',
  'time',
  'product-proof',
  'technical',
  'evidence',
  'decisions',
] as const;

export type NodeSlideArtifactCategory = (typeof NODESLIDE_ARTIFACT_CATEGORIES)[number];

export type NodeSlideArtifactEditability = 'native' | 'grouped-editable' | 'static-fallback';

export type ArtifactShowcaseReceipt = {
  schemaVersion: 'nodeslide.artifact-showcase-receipt/v1';
  candidateId: string;
  candidateDigest: string;
  fixtureId: string;
  directionId: string;
  artifactType: string;
  slideArchetype: string;
  narrativeJob: string;
  model: string;
  modelRole: string;
  candidateKind: 'model' | 'deterministic-baseline';
  harnessVersion: string;
  sourceIds: string[];
  sourceDigest: string;
  referenceIds: string[];
  artifactRequirementDigest: string;
  editability: {
    web: NodeSlideArtifactEditability;
    pptx: NodeSlideArtifactEditability;
  };
  tools: string[];
  evaluation: {
    briefAdherence: boolean;
    visualPassed: boolean;
    evidencePassed: boolean;
    exportPassed: boolean;
    artifactTypeMatched: boolean;
    editabilityPassed: boolean;
    repairCount: number;
    generationMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costMicroUsd: number | null;
  };
  outputs: {
    browserRender: string | null;
    pptxRender: string | null;
    pptxFile: string | null;
    webPptxDifference: string | null;
  };
  status: 'eligible' | 'failed';
  generatedAt: string;
  receiptDigest: string;
};

export type ArtifactAtlasFixture = {
  id: string;
  category: NodeSlideArtifactCategory;
  artifactType: string;
  slideArchetype: string;
  narrativeJob: string;
  prompt: string;
  evidence: Array<{ sourceId: string; label: string; content: string }>;
  allowedClaims: string[];
  forbiddenClaims: string[];
  referenceIds: string[];
  artifactContract: {
    readingDirection: 'left-to-right' | 'top-to-bottom' | 'radial' | 'focal';
    requiredOperations: string[];
    editability: {
      web: NodeSlideArtifactEditability;
      pptx: NodeSlideArtifactEditability;
    };
    fallbackPolicy: string;
  };
};
