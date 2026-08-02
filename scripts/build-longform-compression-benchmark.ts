#!/usr/bin/env -S npx vite-node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type NodeSlidePlannedSlide, buildBriefNodeSlide } from '../convex/lib/nodeslideSeed';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoRoot, 'benchmarks/longform-compression/v1/staar-alcon');
const outputRoot = path.join(repoRoot, 'outputs/longform-compression-v1/staar-alcon');
const load = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(path.join(fixtureRoot, name), 'utf8')) as T;

interface SectionPlan {
  sectionId: string;
  title: string;
  startSlideIndex: number;
  endSlideIndex: number;
}

interface Claim {
  claimId: string;
  statement: string;
  criticality: 'decision-critical' | 'supporting' | 'background';
  value?: number;
  unit?: string;
  evidenceSourceIds: string[];
  longDeckSlideIndexes: number[];
  shortDeckSlideIndexes: number[];
}

const deckProgram = await load<{
  sections: SectionPlan[];
  intentionalSeries: Array<{
    seriesId: string;
    slideIndexes: number[];
    reasonForRepeatedLayout: string;
  }>;
}>('deck-program.json');
const criticalFacts = await load<{ claims: Claim[] }>('critical-facts.json');
const sourceManifest = await load<Record<string, unknown>>('source-manifest.json');

const artifactKinds = [
  'chart',
  'comparison',
  'waterfall',
  'graph',
  'risk-matrix',
  'timeline',
  'sankey',
] as const;
type ArtifactKind = (typeof artifactKinds)[number];

const claimBySlide = new Map<number, Claim[]>();
for (const claim of criticalFacts.claims) {
  for (const index of claim.longDeckSlideIndexes) {
    const claims = claimBySlide.get(index) ?? [];
    claims.push(claim);
    claimBySlide.set(index, claims);
  }
}

const pageTopics: Record<string, string[]> = {
  cover: ['STAAR Surgical / Alcon transaction approval'],
  executive: [
    'Recommendation at a glance',
    'Decision scorecard',
    'What must be true',
    'Committee request',
  ],
  terms: [
    'Consideration and implied value',
    'Offer history and negotiation path',
    'Termination protections',
    'Conditions and closing dependencies',
    'Terms that change the risk/reward',
  ],
  rationale: [
    'Strategic fit with Alcon',
    'Portfolio and channel complementarity',
    'China access and execution thesis',
    'Management synergy claims',
    'Standalone alternatives',
    'Rationale under a downside case',
    'Strategic conclusion',
  ],
  'company-market': [
    'STAAR business model',
    'ICL portfolio and revenue concentration',
    'Geographic mix and China exposure',
    'Customer and channel structure',
    'Market growth claims and evidence gaps',
    'Competitive positioning',
    'Regulatory and reimbursement context',
    'Company/market conclusion',
  ],
  historical: [
    'Historical revenue trajectory',
    'ICL concentration',
    'Q2 revenue dislocation',
    'First-half revenue dislocation',
    'China revenue collapse',
    'Gross-margin pressure',
    'Operating leverage and losses',
    'Liquidity and net cash',
    'Historical conclusion',
  ],
  projections: [
    'Projection framework and caveats',
    'Final management revenue forecast',
    'July diligence revenue case',
    'Final versus July forecast bridge',
    'EBITDA ramp required',
    'China recovery assumptions',
    'Margin and operating-leverage drivers',
    'Forecast risk map',
    'Projection conclusion',
  ],
  valuation: [
    'Valuation framework',
    'Selected public companies',
    'Selected precedent transactions',
    'Discounted cash flow',
    'DCF sensitivity',
    '52-week trading context',
    'Analyst target context',
    'Fairness-opinion conflicts',
  ],
  financing: [
    'Funding structure',
    'Sources and uses',
    'Cash consideration flow',
    'Pro forma capitalization',
    'Financing and capital-structure conclusion',
  ],
  downside: [
    'Downside framework',
    'China recovery miss',
    'Forecast sensitivity',
    'Valuation sensitivity',
    'Standalone downside conclusion',
  ],
  risks: [
    'Risk framework',
    'China and channel risk',
    'Forecast credibility',
    'Process and price challenge',
    'Advisor conflicts and fairness limitations',
  ],
  process: ['Approvals and decision rights', 'Outstanding diligence', 'Closing path and owners'],
  recommendation: ['Conditional recommendation'],
  sources: ['Source register', 'Appendix and claim index'],
};

function pageTopic(index: number, section: SectionPlan) {
  const offset = index - section.startSlideIndex;
  const topic = pageTopics[section.sectionId]?.[offset];
  if (!topic) throw new Error(`No frozen page topic for slide ${index} (${section.sectionId}).`);
  return topic;
}

function quantitativeSeries(
  index: number,
): { labels: string[]; values: number[]; unit: string } | null {
  const series: Record<number, { labels: string[]; values: number[]; unit: string }> = {
    27: {
      labels: ['2022A', '2023A', '2024A'],
      values: [284.391, 322.415, 313.901],
      unit: 'USD millions',
    },
    29: { labels: ['Q2 2024', 'Q2 2025'], values: [99.005, 44.32], unit: 'USD millions' },
    30: { labels: ['H1 2024', 'H1 2025'], values: [176.361, 86.909], unit: 'USD millions' },
    31: { labels: ['Q2 2024', 'Q2 2025'], values: [63.519, 5.299], unit: 'USD millions' },
    36: {
      labels: ['2025E', '2026E', '2027E', '2028E', '2029E', '2030E'],
      values: [260, 340, 375, 408, 448, 495],
      unit: 'USD millions',
    },
    37: { labels: ['2025E', '2026E', '2027E'], values: [256, 350, 428], unit: 'USD millions' },
    38: {
      labels: ['Final 2025E', 'July 2025E', 'Final 2026E', 'July 2026E'],
      values: [260, 256, 340, 350],
      unit: 'USD millions',
    },
    39: { labels: ['2025E', '2026E', '2027E'], values: [7, 98, 142], unit: 'USD millions EBITDA' },
    45: {
      labels: ['Public comps low', 'Public comps high', 'Offer'],
      values: [16.35, 23.8, 28],
      unit: 'USD/share',
    },
    46: {
      labels: ['Precedents low', 'Offer', 'Precedents high'],
      values: [17.15, 28, 30.8],
      unit: 'USD/share',
    },
    47: { labels: ['DCF low', 'Offer', 'DCF high'], values: [17.7, 28, 37.5], unit: 'USD/share' },
    48: {
      labels: ['Discount rate low', 'Discount rate high'],
      values: [13.4, 14.6],
      unit: 'percent',
    },
    49: {
      labels: ['52-week low', 'Offer', '52-week high'],
      values: [15.09, 28, 40.36],
      unit: 'USD/share',
    },
  };
  return series[index] ?? null;
}

function compressedQuantitativeSeries(index: number) {
  const series: Record<number, { labels: string[]; values: number[]; unit: string }> = {
    5: {
      labels: ['2024 net sales', 'Q2 2024', 'Q2 2025'],
      values: [313.901, 99.005, 44.32],
      unit: 'USD millions',
    },
    6: { labels: ['2026E', '2030E'], values: [340, 495], unit: 'USD millions' },
    7: {
      labels: ['Public comps low', 'Public comps high', 'Offer', 'DCF high'],
      values: [16.35, 23.8, 28, 37.5],
      unit: 'USD/share',
    },
  };
  return series[index] ?? null;
}

function sectionFor(index: number) {
  const section = deckProgram.sections.find(
    (candidate) => index >= candidate.startSlideIndex && index <= candidate.endSlideIndex,
  );
  if (!section) throw new Error(`No DeckProgram section covers slide ${index}`);
  return section;
}

function artifactKindFor(index: number, sectionId: string): ArtifactKind | null {
  if ([1, 2, 5, 11, 18, 26, 35, 44, 52, 57, 62, 67, 70, 71, 72].includes(index)) return null;
  if (sectionId === 'historical' && index >= 27 && index <= 30) return 'chart';
  if (sectionId === 'projections' && index >= 36 && index <= 39) return 'chart';
  if (sectionId === 'valuation' && index >= 45 && index <= 49) return 'comparison';
  if (sectionId === 'risks' && index >= 63 && index <= 65) return 'risk-matrix';
  if (sectionId === 'historical')
    return ({ 31: 'risk-matrix', 32: 'waterfall', 33: 'comparison', 34: 'graph' } as const)[
      index as 31 | 32 | 33 | 34
    ];
  if (sectionId === 'projections')
    return ({ 40: 'waterfall', 41: 'sankey', 42: 'graph', 43: null } as const)[
      index as 40 | 41 | 42 | 43
    ];
  if (sectionId === 'valuation') return index === 50 ? null : 'waterfall';
  if (sectionId === 'downside')
    return ({ 58: 'timeline', 59: 'waterfall', 60: 'sankey', 61: null } as const)[
      index as 58 | 59 | 60 | 61
    ];
  if (sectionId === 'risks') return index === 66 ? 'sankey' : 'risk-matrix';
  if (sectionId === 'terms')
    return ['timeline', 'comparison', 'graph', 'waterfall', 'risk-matrix'][
      index - 6
    ] as ArtifactKind;
  if (sectionId === 'process')
    return ({ 67: null, 68: 'timeline', 69: 'waterfall' } as const)[index as 67 | 68 | 69];
  if (sectionId === 'financing')
    return ['sankey', 'waterfall', 'graph', 'sankey', 'timeline'][index - 52] as ArtifactKind;
  if (sectionId === 'rationale')
    return (
      {
        12: 'graph',
        13: 'sankey',
        14: 'chart',
        15: null,
        16: 'risk-matrix',
        17: 'timeline',
      } as const
    )[index as 12 | 13 | 14 | 15 | 16 | 17];
  if (sectionId === 'company-market')
    return (
      {
        19: 'graph',
        20: 'chart',
        21: 'risk-matrix',
        22: null,
        23: 'sankey',
        24: 'timeline',
        25: 'comparison',
      } as const
    )[index as 19 | 20 | 21 | 22 | 23 | 24 | 25];
  return ['graph', 'timeline', 'sankey', 'risk-matrix', 'waterfall', 'comparison', 'chart'][
    index % 7
  ] as ArtifactKind;
}

function artifactSpec(
  index: number,
  kind: ArtifactKind,
  claims: Claim[],
  topic: string,
  series: { labels: string[]; values: number[]; unit: string } | null,
) {
  const safeValues = series?.values ?? [];
  const common = {
    schemaVersion: 'nodeslide.artifact-spec/v1' as const,
    id: `staar-${kind}-${index}`,
    kind,
    narrativeJob: `Make slide ${index}'s ${kind} relationship inspectable and editable.`,
    claimIds: claims.map((claim) => claim.claimId),
    sourceIds: ['brief:prompt'],
    provenance: {
      truthState: 'derived' as const,
      rationale: 'Values and relationships are bounded by the frozen pre-vote source bundle.',
      sourceRefs: ['brief:prompt'],
    },
  };
  switch (kind) {
    case 'chart':
      return {
        ...common,
        payload: {
          unit: series?.unit ?? claims[0]?.unit ?? 'reported value',
          xAxis: { labels: series?.labels ?? [] },
          yAxis: { min: Math.min(0, ...safeValues), max: Math.max(...safeValues) * 1.15 },
          series: [{ id: 'reported-or-derived', values: safeValues }],
        },
      };
    case 'comparison':
      return {
        ...common,
        payload: {
          metrics: [{ id: 'value', unit: series?.unit ?? claims[0]?.unit ?? 'reported value' }],
          cohorts: safeValues.slice(0, 4).map((value, valueIndex) => ({
            id: series?.labels[valueIndex] ?? `case-${valueIndex + 1}`,
            status: 'observed',
            plotted: true,
            values: { value },
          })),
        },
      };
    case 'waterfall': {
      const baseline = Math.abs(safeValues[0] ?? 0);
      const deltas = safeValues.slice(1, 3).map((value, valueIndex) => ({
        label: `Driver ${valueIndex + 1}`,
        value: value - baseline,
      }));
      return {
        ...common,
        payload: {
          unit: series?.unit ?? claims[0]?.unit ?? 'reported value',
          baseline,
          deltas,
          final: baseline + deltas.reduce((sum, item) => sum + item.value, 0),
          tolerance: 0.001,
        },
      };
    }
    case 'graph':
      return {
        ...common,
        payload: {
          directed: true,
          graphKind: 'process',
          direction: index % 2 === 0 ? 'horizontal' : 'vertical',
          nodes: [
            { id: 'evidence', label: topic, kind: 'system' },
            {
              id: 'condition',
              label: claims[0]?.statement ?? 'Unresolved evidence',
              kind: 'decision',
            },
            { id: 'decision', label: 'Committee decision', kind: 'milestone' },
          ],
          edges: [
            { id: 'edge-1', from: 'evidence', to: 'condition', directed: true },
            { id: 'edge-2', from: 'condition', to: 'decision', directed: true },
          ],
        },
      };
    case 'risk-matrix':
      return {
        ...common,
        payload: {
          likelihoodAxis: { low: 'rare', high: 'likely' },
          impactAxis: { low: 'minor', high: 'critical' },
          risks: [
            { id: `primary-${index}`, label: topic, likelihood: 4, impact: 5 },
            {
              id: `evidence-${index}`,
              label: claims[0]?.statement ?? 'Evidence remains incomplete',
              likelihood: 3,
              impact: 4,
            },
            {
              id: `decision-${index}`,
              label: 'Decision changes if assumption fails',
              likelihood: 2,
              impact: 4,
            },
          ],
        },
      };
    case 'timeline':
      return {
        ...common,
        payload: {
          unit: 'day',
          events: [
            { id: 'agreement', label: 'Agreement signed · Aug 4', start: 1, end: 1 },
            { id: 'proxy', label: `${topic} · Sep 16 proxy`, start: 43, end: 43 },
            { id: 'cutoff', label: 'Pre-vote cutoff · Sep 26', start: 53, end: 53 },
          ],
        },
      };
    case 'sankey':
      return {
        ...common,
        payload: {
          unit: 'transaction value',
          nodes: [
            { id: 'funding', label: 'Alcon funding', layer: 'source' },
            { id: 'consideration', label: 'Cash consideration', layer: 'middle' },
            { id: 'holders', label: 'STAAR holders', layer: 'sink' },
          ],
          links: [
            { source: 'funding', target: 'consideration', value: 100 },
            { source: 'consideration', target: 'holders', value: 100 },
          ],
        },
      };
  }
}

function longSlide(index: number): NodeSlidePlannedSlide {
  const section = sectionFor(index);
  const claims = claimBySlide.get(index) ?? [];
  const topic = pageTopic(index, section);
  const series = quantitativeSeries(index);
  const requestedKind = artifactKindFor(index, section.sectionId);
  const kind = series
    ? requestedKind === 'comparison' || requestedKind === 'waterfall'
      ? requestedKind
      : 'chart'
    : requestedKind === 'sankey'
      ? 'graph'
      : requestedKind && ['chart', 'comparison', 'waterfall'].includes(requestedKind)
        ? null
        : requestedKind;
  const primary = claims[0];
  const sectionOffset = index - section.startSlideIndex + 1;
  const headline = primary?.statement ?? topic;
  const body =
    claims.length > 1
      ? `Reconcile ${claims
          .slice(1)
          .map((claim) => claim.statement)
          .join(' ')} Keep advocacy, primary evidence, and unresolved diligence visibly separate.`
      : `${topic} is assessed only from the frozen pre-vote bundle. Separate reported evidence, attributed management claims, derived analysis, and the diligence still needed to change the recommendation.`;
  return {
    title: index === 1 ? 'STAAR Surgical / Alcon' : `${section.title} · ${sectionOffset}`,
    section: `${String(index).padStart(2, '0')} / ${section.title}`,
    headline,
    body,
    bullets: [
      claims[0]?.statement ?? `${topic}: contemporaneous evidence only`,
      claims[1]?.statement ??
        `Decision implication: test ${topic.toLocaleLowerCase()} against the downside case`,
      `Open diligence: identify the source or owner that can resolve ${topic.toLocaleLowerCase()}`,
    ],
    ...(kind ? { artifactSpec: artifactSpec(index, kind, claims, topic, series) } : {}),
    ...(!kind && primary?.value !== undefined
      ? { metric: String(primary.value), metricLabel: primary.unit ?? 'reported value' }
      : !kind && index === 67
        ? { metric: '3', metricLabel: 'approval and diligence checkpoints' }
        : {}),
  };
}

function compressedSlide(index: number, kind: 'short' | 'executive'): NodeSlidePlannedSlide {
  const shortTitles = [
    'Recommendation and requested decision',
    'Transaction terms',
    'Core strategic thesis',
    'Company and market',
    'Historical financial profile',
    'Forecast and principal drivers',
    'Valuation',
    'Downside and sensitivities',
    'Financing and capitalization',
    'Principal risks',
    'Outstanding diligence and conditions',
    'Decision summary and appendix links',
  ];
  const executiveTitles = ['Decision', 'Economics', 'Downside', 'Conditions to proceed'];
  const title =
    (kind === 'short' ? shortTitles : executiveTitles)[index - 1] ?? `Decision page ${index}`;
  const claims = criticalFacts.claims
    .filter((claim) =>
      kind === 'short'
        ? claim.shortDeckSlideIndexes.includes(index)
        : claim.criticality === 'decision-critical',
    )
    .slice(0, kind === 'short' ? 4 : 3);
  const series = kind === 'short' ? compressedQuantitativeSeries(index) : null;
  const shortArtifactKinds: ArtifactKind[] = [
    'graph',
    'comparison',
    'chart',
    'risk-matrix',
    'risk-matrix',
    'chart',
    'comparison',
    'risk-matrix',
    'sankey',
    'waterfall',
    'timeline',
    'graph',
  ];
  const executiveArtifactKinds: ArtifactKind[] = ['graph', 'comparison', 'risk-matrix', 'timeline'];
  const requestedArtifactKind =
    kind === 'short' && index === 12
      ? null
      : ((kind === 'short' ? shortArtifactKinds : executiveArtifactKinds)[index - 1] ?? 'graph');
  const artifactKind = series
    ? requestedArtifactKind === 'comparison'
      ? 'comparison'
      : 'chart'
    : requestedArtifactKind === 'sankey'
      ? 'graph'
      : requestedArtifactKind &&
          ['chart', 'comparison', 'waterfall'].includes(requestedArtifactKind)
        ? null
        : requestedArtifactKind;
  return {
    title,
    section: `${kind === 'short' ? 'Memo' : 'Readout'} / ${String(index).padStart(2, '0')}`,
    headline: claims[0]?.statement ?? `${title} remains conditional on unresolved diligence.`,
    body:
      claims
        .slice(1)
        .map((claim) => claim.statement)
        .join(' ') ||
      'No new claim is introduced during compression; this page points back to accepted long-deck evidence.',
    bullets:
      index === 12
        ? ['Approve only with the stated conditions and linked diligence owners']
        : [
            claims[0]?.statement ?? `Memo page ${index}: preserve the decision, not every page`,
            claims[1]?.statement ?? 'Retain downside and source coverage',
            claims[2]?.statement ?? 'Link unresolved diligence to an owner',
          ],
    ...(artifactKind
      ? { artifactSpec: artifactSpec(index, artifactKind, claims, title, series) }
      : {}),
  };
}

function buildDeck(kind: 'long' | 'short' | 'executive') {
  const count = kind === 'long' ? 72 : kind === 'short' ? 12 : 4;
  const title =
    kind === 'long'
      ? 'STAAR Surgical / Alcon — 72-slide transaction approval'
      : kind === 'short'
        ? 'STAAR Surgical / Alcon — 12-slide opportunity memo'
        : 'STAAR Surgical / Alcon — 4-slide executive readout';
  const slides = Array.from({ length: count }, (_, offset) =>
    kind === 'long' ? longSlide(offset + 1) : compressedSlide(offset + 1, kind),
  );
  const sourceUrls = Object.values(sourceManifest)
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .flatMap((source) => (source.generationVisible ? (source.sourceRefs ?? []) : []))
    .filter((value): value is string => typeof value === 'string');
  return buildBriefNodeSlide({
    deckId: `benchmark-staar-alcon-${kind}`,
    projectId: 'benchmark-longform-compression-v1',
    title,
    brief: {
      prompt: `Create exactly ${count} slides from the frozen pre-vote source bundle only. ${sourceUrls.join(' ')}`,
      audience:
        kind === 'executive' ? 'Executive decision makers' : 'Transaction approval committee',
      purpose:
        kind === 'long'
          ? 'decide whether to approve the transaction'
          : 'compress the accepted decision structure without changing its interpretation',
      successCriteria: [
        'Preserve exact transaction terms and critical numbers',
        'Expose downside, conflicts, and unresolved diligence',
        'Keep every material claim source-grounded',
      ],
    },
    themeId: 'quiet-precision',
    rawSpec: {
      title,
      narrative: [
        'Orient the decision',
        'Reconcile evidence',
        'Stress downside',
        'Conclude conditionally',
      ],
      slides,
      ...(kind === 'long' ? { intentionalSeries: deckProgram.intentionalSeries } : {}),
    },
    now: Date.UTC(2026, 7, 1),
  });
}

await mkdir(outputRoot, { recursive: true });
const built = {
  long: buildDeck('long'),
  short: buildDeck('short'),
  executive: buildDeck('executive'),
};
for (const [kind, result] of Object.entries(built)) {
  await writeFile(
    path.join(outputRoot, `${kind}.nodeslide.json`),
    `${JSON.stringify(result.snapshot, null, 2)}\n`,
  );
  await writeFile(
    path.join(outputRoot, `${kind}.spec.json`),
    `${JSON.stringify(result.spec, null, 2)}\n`,
  );
}

const eligibility = Array.from({ length: 72 }, (_, offset) => {
  const slideIndex = offset + 1;
  const section = sectionFor(slideIndex);
  const selectedArtifact = artifactKindFor(slideIndex, section.sectionId);
  return {
    slideIndex,
    narrativeRole: section.title,
    evidenceRelationships: (claimBySlide.get(slideIndex) ?? []).map((claim) => claim.claimId),
    eligibleArtifacts: selectedArtifact ? [selectedArtifact] : [],
    ...(selectedArtifact ? { requiredArtifact: selectedArtifact, selectedArtifact } : {}),
    textOnlyPermitted: selectedArtifact === null,
    reason: selectedArtifact
      ? `The ${section.title.toLocaleLowerCase()} evidence requires an editable ${selectedArtifact} relationship.`
      : 'This page is a cover, transition, recommendation, or source register where a native quantitative artifact is not required.',
  };
});
await writeFile(
  path.join(outputRoot, 'slide-artifact-eligibility.json'),
  `${JSON.stringify(eligibility, null, 2)}\n`,
);

const compressionLedger = criticalFacts.claims.map((claim) => ({
  sourceClaimId: claim.claimId,
  sourceSlideIndexes: claim.longDeckSlideIndexes,
  criticality: claim.criticality,
  disposition: 'retained_compressed',
  targetSlideIndexes: claim.shortDeckSlideIndexes,
  rationale:
    'The claim answers a frozen decision question or supports a decision-critical conclusion.',
  preservedEvidenceRefs: claim.evidenceSourceIds,
}));
await writeFile(
  path.join(outputRoot, 'compression-ledger.json'),
  `${JSON.stringify(compressionLedger, null, 2)}\n`,
);

const digest = (value: unknown) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
await writeFile(
  path.join(outputRoot, 'pre-inspection-receipt.json'),
  `${JSON.stringify(
    {
      benchmarkId: 'nodeslide-longform-compression-v1',
      caseId: 'staar-alcon-pre-vote-2025-09-26',
      deckDigests: Object.fromEntries(
        Object.entries(built).map(([kind, result]) => [kind, digest(result.snapshot)]),
      ),
      counts: Object.fromEntries(
        Object.entries(built).map(([kind, result]) => [kind, result.snapshot.slides.length]),
      ),
      passed: false,
      failures: [
        'Browser/PPTX renders have not been inspected page by page.',
        'Critical-fact render reconciliation is pending.',
      ],
    },
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      outputRoot,
      counts: {
        long: built.long.snapshot.slides.length,
        short: built.short.snapshot.slides.length,
        executive: built.executive.snapshot.slides.length,
      },
      deckDiversity: built.long.spec.deckDiversity,
    },
    null,
    2,
  ),
);
