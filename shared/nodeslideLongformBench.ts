/**
 * Contracts for the NodeSlide Longform & Compression Bench.
 *
 * The benchmark is deliberately receipt-driven: a run is incomplete until
 * evidence, compression, both render paths, and page-level observations have
 * all been reconciled.
 */

export type ReferenceDeckFamily =
  | 'transaction-presentation'
  | 'transaction-approval'
  | 'investor-day'
  | 'earnings'
  | 'opportunity-memo'
  | 'board-update'
  | 'academic-talk';

export interface ReferenceSection {
  sectionId: string;
  title: string;
  startSlideIndex: number;
  endSlideIndex: number;
  purpose: string;
}

export interface ReferenceSlideObservation {
  slideIndex: number;
  narrativeRole: string;
  sectionRole: string;
  normalizedElementGrid: string;
  dominantVisual: string;
  artifactFamily: string;
  density: 'low' | 'medium' | 'high';
  sourcePlacement: string;
  previousSlideRelationship: string;
  nextSlideRelationship: string;
  intentionalRepetition: boolean;
}

export interface ReferenceDeckManifest {
  referenceDeckId: string;
  digest: string;
  family: ReferenceDeckFamily;
  source: {
    organization: string;
    filingOrSourceId?: string;
    sourceDate: string;
    sourceRefs: string[];
  };
  rights: {
    permittedUse: 'evaluation-only' | 'structure-only' | 'structure-and-style';
  };
  deckStructure: {
    slideCount: number;
    sections: ReferenceSection[];
    narrativeArc: string[];
  };
  slides: ReferenceSlideObservation[];
  annotations: {
    strongPatterns: string[];
    weakPatterns: string[];
    repeatedSystems: string[];
    appendixPolicy?: string;
  };
}

export interface DeckSectionPlan {
  sectionId: string;
  title: string;
  startSlideIndex: number;
  endSlideIndex: number;
  requiredDecisionQuestions: string[];
}

export interface DeckProgram {
  exactSlideCount: number;
  sections: DeckSectionPlan[];
  recurringSystems: {
    financialTables: string;
    valuationPages: string;
    riskPages: string;
    sourceNotes: string;
  };
  intentionalSeries: Array<{
    seriesId: string;
    slideIndexes: number[];
    reasonForRepeatedLayout: string;
  }>;
}

export interface SlideArtifactEligibility {
  slideIndex: number;
  narrativeRole: string;
  evidenceRelationships: string[];
  eligibleArtifacts: string[];
  requiredArtifact?: string;
  selectedArtifact?: string;
  fallbackReasonCode?: string;
  textOnlyPermitted: boolean;
  reason: string;
}

export type VisualInspectionCheck = 'pass' | 'fail';

export interface SlideVisualInspectionReceipt {
  deckKind: 'long' | 'short' | 'executive';
  slideIndex: number;
  inspectionSource: 'independent-ledger';
  assessmentDigest: string;
  browserImageDigest: string;
  pptxImageDigest: string;
  checks: {
    overlap: VisualInspectionCheck;
    clipping: VisualInspectionCheck;
    minimumType: VisualInspectionCheck;
    sourceLegibility: VisualInspectionCheck;
    visualHierarchy: VisualInspectionCheck;
    semanticVisualFit: VisualInspectionCheck;
    density: VisualInspectionCheck;
    exportParity: VisualInspectionCheck;
  };
  observedProblems: string[];
  requiredRepairs: string[];
  inspectedBy: string;
  inspectedAt: string;
}

export type CompressionDisposition =
  | 'retained_verbatim'
  | 'retained_compressed'
  | 'merged'
  | 'moved_to_appendix'
  | 'omitted_noncritical'
  | 'omitted_redundant';

export interface CompressionLedgerEntry {
  sourceClaimId: string;
  sourceSlideIndexes: number[];
  criticality: 'decision-critical' | 'supporting' | 'background';
  disposition: CompressionDisposition;
  targetSlideIndexes: number[];
  rationale: string;
  preservedEvidenceRefs: string[];
}

export type BenchmarkSourceRole =
  | 'evidence-source'
  | 'visual-storytelling-precedent'
  | 'evaluation-target'
  | 'hidden-hindsight';

export interface BenchmarkSourceManifestEntry {
  sourceId: string;
  role: BenchmarkSourceRole;
  title: string;
  organization: string;
  sourceDate: string;
  sourceRefs: string[];
  generationVisible: boolean;
  authority: 'primary' | 'secondary' | 'advocacy' | 'evaluation-only';
  permittedUse: string[];
  digest?: string;
}

export interface CanonicalEvidenceClaim {
  claimId: string;
  statement: string;
  criticality: 'decision-critical' | 'supporting' | 'background';
  value?: number;
  unit?: string;
  asOfDate?: string;
  evidenceSourceIds: string[];
  longDeckSlideIndexes: number[];
  shortDeckSlideIndexes: number[];
}

export interface DecisionQuestion {
  questionId: string;
  question: string;
  expectedClaimIds: string[];
  decisionCritical: boolean;
}

export interface LongformBenchmarkReleaseReceipt {
  benchmarkId: string;
  caseId: string;
  sourceManifestDigest: string;
  canonicalEvidenceGraphDigest: string;
  longDeckDigest: string;
  shortDeckDigest: string;
  executiveReadoutDigest?: string;
  compressionLedgerDigest: string;
  pageInspectionReceiptDigest: string;
  completedPageInspections: number;
  requiredPageInspections: number;
  criticalFactsReconciled: boolean;
  everyCompressionDecisionRecorded: boolean;
  browserAndPptxParityVerified: boolean;
  passed: boolean;
  failures: string[];
}
