#!/usr/bin/env -S npx vite-node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type NodeSlidePlannedSlide, buildBriefNodeSlide } from '../convex/lib/nodeslideSeed';
import {
  findGenericNarrativeFallbacks,
  findMissingRenderedClaims,
  validateGeneratedDeckGates,
} from './lib/longform-compression-core.mjs';

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
const claimById = new Map(criticalFacts.claims.map((claim) => [claim.claimId, claim]));

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

const shortClaimIdsBySlide = [
  ['offer-price', 'attributed-board-rationale', 'open-diligence-boundary'],
  ['staar-termination-fee', 'reduced-termination-fee', 'alcon-regulatory-fee'],
  ['prior-offer', 'offer-premium', 'h1-2025-sales'],
  ['business-scale', 'regional-sales-change'],
  ['2024-sales', 'q2-2025-sales', 'q2-2025-sales-decline'],
  ['2026e-sales', '2030e-sales', 'projection-growth-assumption'],
  ['public-comps-range', 'precedents-range', 'dcf-range'],
  ['dcf-discount-rate', 'q2-china-sales', 'q2-gross-margin'],
  ['alcon-funding-representation', 'standalone-liquidity', 'q2-operating-loss'],
  ['citi-contingent-fee', 'citi-forecast-reliance', 'fairness-not-vote-recommendation'],
  ['vote-threshold', 'regulatory-clearances', 'broadwood-opposition'],
  [],
];
const shortClaimsBySlide = new Map(
  shortClaimIdsBySlide.map((claimIds, offset) => [
    offset + 1,
    claimIds.flatMap((claimId) => {
      const claim = claimById.get(claimId);
      if (!claim) throw new Error(`Short-deck program references unknown claim ${claimId}.`);
      return [claim];
    }),
  ]),
);
const assignedShortClaimIds = new Set(
  [...shortClaimsBySlide.values()].flatMap((claims) => claims.map((claim) => claim.claimId)),
);
if (assignedShortClaimIds.size !== criticalFacts.claims.length) {
  const missing = criticalFacts.claims
    .filter((claim) => !assignedShortClaimIds.has(claim.claimId))
    .map((claim) => claim.claimId);
  throw new Error(`Short-deck program does not account for every claim: ${missing.join(', ')}`);
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
    32: { labels: ['Q2 2024', 'Q2 2025'], values: [79.2, 74], unit: 'percent gross margin' },
    33: {
      labels: ['Q2 2024', 'Q2 2025'],
      values: [12, -67.6],
      unit: 'percent operating income (loss)',
    },
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
    40: { labels: ['2026E', '2030E'], values: [340, 495], unit: 'USD millions net sales' },
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
    50: { labels: ['Contingent fee', 'Total fee'], values: [26.6, 30.6], unit: 'USD millions' },
    57: {
      labels: ['Q2 2024 sales', 'Q2 2025 sales', 'China 2024', 'China 2025'],
      values: [99.005, 44.32, 63.519, 5.299],
      unit: 'USD millions',
    },
    62: {
      labels: ['April 2024 proposal', 'August 2025 agreement'],
      values: [58, 28],
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
    return ({ 40: 'waterfall', 41: 'graph', 42: 'risk-matrix', 43: null } as const)[
      index as 40 | 41 | 42 | 43
    ];
  if (sectionId === 'valuation') return index === 50 ? null : 'waterfall';
  if (sectionId === 'downside')
    return ({ 58: null, 59: 'waterfall', 60: null, 61: null } as const)[index as 58 | 59 | 60 | 61];
  if (sectionId === 'risks')
    return index === 62 ? 'comparison' : index === 66 ? null : 'risk-matrix';
  if (sectionId === 'terms')
    return ['timeline', 'comparison', 'graph', 'waterfall', 'risk-matrix'][
      index - 6
    ] as ArtifactKind;
  if (sectionId === 'process')
    return ({ 67: 'graph', 68: 'graph', 69: 'graph' } as const)[index as 67 | 68 | 69];
  if (sectionId === 'financing')
    return ['graph', 'graph', 'graph', null, null][index - 52] as ArtifactKind | null;
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
        23: null,
        24: 'graph',
        25: 'comparison',
      } as const
    )[index as 19 | 20 | 21 | 22 | 23 | 24 | 25];
  return ['graph', 'timeline', 'sankey', 'risk-matrix', 'waterfall', 'comparison', 'chart'][
    index % 7
  ] as ArtifactKind;
}

function effectiveArtifactKind(
  requestedKind: ArtifactKind | null,
  series: { labels: string[]; values: number[]; unit: string } | null,
): ArtifactKind | null {
  if (requestedKind === null) return null;
  if (series) {
    return requestedKind === 'comparison' || requestedKind === 'waterfall'
      ? requestedKind
      : 'chart';
  }
  if (requestedKind === 'sankey' || requestedKind === 'timeline') return 'graph';
  if (requestedKind && ['chart', 'comparison', 'waterfall'].includes(requestedKind)) return null;
  return requestedKind;
}

function evidenceBoundNarrative(sectionId: string, topic: string) {
  const topicLower = topic.toLocaleLowerCase();
  const copy: Record<string, { body: string; bullets: string[] }> = {
    executive: {
      body: `Frame ${topicLower} as a committee decision, not a promotional summary. State the evidence that changes the recommendation and the condition that remains open.`,
      bullets: [
        `Decision: resolve ${topicLower}`,
        'Evidence boundary: filed facts and explicitly attributed advocacy only',
        'Condition: no approval while a recommendation-changing assumption remains open',
      ],
    },
    terms: {
      body: `Read ${topicLower} from the merger agreement and definitive proxy. Separate enforceable terms, attributed process history, and closing dependencies.`,
      bullets: [
        `Term under review: ${topic}`,
        'Decision test: quantify the value or obligation without interpolation',
        'Source boundary: agreement and definitive proxy control',
      ],
    },
    rationale: {
      body: `Treat ${topicLower} as attributed Board or management rationale until independent evidence corroborates it. Test the claim against standalone execution and China concentration.`,
      bullets: [
        `Attributed thesis: ${topic}`,
        'Counterweight: standalone value and forecast execution risk',
        'Required proof: independent evidence beyond transaction advocacy',
      ],
    },
    'company-market': {
      body: `Use the filings to establish ${topicLower}; distinguish installed scale from current demand durability and geographic concentration.`,
      bullets: [
        `Observed business evidence: ${topic}`,
        'Durability test: regional growth outside China versus China deterioration',
        'Do not convert company positioning into independent market proof',
      ],
    },
    historical: {
      body: `Anchor ${topicLower} to filed actuals and comparable periods. Keep reported values, derived changes, and missing evidence visibly separate.`,
      bullets: [
        `Filed actuals: ${topic}`,
        'Comparison rule: identical periods and units',
        'Decision implication: identify whether the standalone base has stabilized',
      ],
    },
    projections: {
      body: `Management projections are unaudited. For ${topicLower}, separate the final case from July diligence estimates and expose the assumption that creates the bridge.`,
      bullets: [
        `Projection evidence: ${topic}`,
        'Required bridge: final case versus July diligence case',
        'Downside test: China recovery, new products, and operating leverage',
      ],
    },
    valuation: {
      body: `Evaluate ${topicLower} within Citi's stated scope and limitations. Keep the $28 offer marker constant and do not treat the fairness opinion as a voting recommendation.`,
      bullets: [
        `Valuation method: ${topic}`,
        'Common reference: $28 cash offer',
        'Limitation: management forecasts were not independently verified by Citi',
      ],
    },
    financing: {
      body: `The proxy records Alcon's sufficiency-of-funds representation for ${topicLower}; it does not disclose a new financing commitment or justify invented leverage assumptions.`,
      bullets: [
        `Funding evidence: ${topic}`,
        'Known: consideration plus related fees and expenses are covered',
        'Unknown: do not invent debt mix, pricing, or pro forma leverage',
      ],
    },
    downside: {
      body: `Stress ${topicLower} against the observed China decline, margin compression, and the final projection assumptions. Preserve the base case and downside case as separate states.`,
      bullets: [
        `Downside variable: ${topic}`,
        'Observed anchor: current filed performance',
        'Decision threshold: recommendation changes if recovery evidence fails',
      ],
    },
    risks: {
      body: `Treat ${topicLower} as recommendation-changing until evidence, mitigation, owner, and decision cutoff are explicit.`,
      bullets: [
        `Risk: ${topic}`,
        'Evidence: primary filing or attributed opposition only',
        'Mitigation: named owner and dated proof before approval',
      ],
    },
    process: {
      body: `Convert ${topicLower} into an enforceable approval condition with an owner, source, and cutoff. Regulatory clearances and the stockholder vote are closing facts, not decorative milestones.`,
      bullets: [
        `Process requirement: ${topic}`,
        'Owner: transaction team must record the accountable reviewer',
        'Cutoff: resolve before the committee decision or keep the gate closed',
      ],
    },
    recommendation: {
      body: 'The recommendation is conditional: preserve the $28 economics, but keep the gate closed until China durability, the forecast bridge, and regulatory clearances are resolved.',
      bullets: [
        'Approve only with named evidence conditions',
        'Do not treat management advocacy as independent support',
        'Escalate any critical numerical mismatch or unresolved source gap',
      ],
    },
    sources: {
      body: `Index ${topicLower} by canonical claim id, filing date, and locator so every number and conclusion can be traced from long deck to memo.`,
      bullets: [
        `Register: ${topic}`,
        'Separate evidence, visual precedent, evaluation target, and hidden hindsight',
        'No missing locator for a decision-critical claim',
      ],
    },
  };
  return (
    copy[sectionId] ?? {
      body: `${topic} must be resolved from the frozen source bundle without inventing evidence.`,
      bullets: [topic, 'Primary evidence only', 'Record the decision implication'],
    }
  );
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
              label: claims[0]?.statement ?? `Resolve ${topic.toLocaleLowerCase()}`,
              kind: 'decision',
            },
            {
              id: 'decision',
              label: `Decision on ${topic.toLocaleLowerCase()}`,
              kind: 'milestone',
            },
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
              label: 'Evidence quality',
              likelihood: 3,
              impact: 4,
            },
            {
              id: `decision-${index}`,
              label: 'Recommendation sensitivity',
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
  const kind = effectiveArtifactKind(requestedKind, series);
  const primary = claims[0];
  const sectionOffset = index - section.startSlideIndex + 1;
  const headline = topic;
  const boundedNarrative = evidenceBoundNarrative(section.sectionId, topic);
  const body =
    claims.length > 1
      ? `${topic}: reconcile ${claims
          .map((claim) => claim.statement)
          .join(' ')} Keep advocacy, primary evidence, and unresolved diligence visibly separate.`
      : primary
        ? `${topic}: ${primary.statement} Preserve its source boundary and state the decision implication without adding an unsupported conclusion.`
        : boundedNarrative.body;
  return {
    title: index === 1 ? 'STAAR Surgical / Alcon' : `${section.title} · ${sectionOffset}`,
    section: `${String(index).padStart(2, '0')} / ${section.title}`,
    headline,
    body,
    bullets: (claims.length > 0
      ? [
          claims[0]?.statement ?? boundedNarrative.bullets[0],
          claims[1]?.statement ?? `Lens: ${topic}`,
          `Decision implication: ${boundedNarrative.bullets[2]}`,
        ]
      : boundedNarrative.bullets
    ).slice(0, kind === 'chart' || kind === 'waterfall' || kind === 'comparison' ? 2 : 3),
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
  const executiveClaimIds = [
    ['offer-price', 'vote-threshold', 'open-diligence-boundary'],
    ['offer-premium', 'q2-2025-sales', 'standalone-liquidity'],
    ['q2-china-sales', 'projection-growth-assumption', 'prior-offer'],
    ['regulatory-clearances', 'broadwood-opposition', 'citi-forecast-reliance'],
  ];
  const claims =
    kind === 'short'
      ? (shortClaimsBySlide.get(index) ?? [])
      : (executiveClaimIds[index - 1] ?? []).flatMap((claimId) => {
          const claim = claimById.get(claimId);
          return claim ? [claim] : [];
        });
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
  const artifactKind = effectiveArtifactKind(requestedArtifactKind, series);
  return {
    title,
    section: `${kind === 'short' ? 'Memo' : 'Readout'} / ${String(index).padStart(2, '0')}`,
    headline: title,
    body:
      claims.map((claim) => claim.statement).join('\n') ||
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
const generatedGateFailures = validateGeneratedDeckGates({
  built,
  expectedCounts: { long: 72, short: 12, executive: 4 },
});
if (generatedGateFailures.length > 0) {
  throw new Error(
    `Generated deck gates failed: ${generatedGateFailures.join('; ')}. Diversity: ${JSON.stringify(
      Object.fromEntries(
        Object.entries(built).map(([kind, result]) => [kind, result.spec.deckDiversity]),
      ),
    )}`,
  );
}
for (const kind of ['long', 'short'] as const) {
  const missingRenderedClaims = findMissingRenderedClaims(
    built[kind].snapshot,
    criticalFacts.claims,
  );
  if (missingRenderedClaims.length > 0) {
    throw new Error(`${kind} deck dropped rendered claims: ${missingRenderedClaims.join(', ')}`);
  }
}
const repeatedNarrativeFailures = findGenericNarrativeFallbacks(
  built.long.snapshot.elements.map((element) => element.content ?? ''),
);
if (repeatedNarrativeFailures.length > 0) {
  throw new Error(
    `Long-form narrative still contains generic fallback copy: ${repeatedNarrativeFailures.join(', ')}`,
  );
}
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
  const selectedArtifact = effectiveArtifactKind(
    artifactKindFor(slideIndex, section.sectionId),
    quantitativeSeries(slideIndex),
  );
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
