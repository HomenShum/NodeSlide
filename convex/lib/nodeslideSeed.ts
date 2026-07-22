import {
  type BoundingBox,
  type DeckBrief,
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type Slide,
  type SlideArchetype,
  type SlideElement,
  type SourceRecord,
  type ThemeSpec,
  isNodeSlideEmbeddedRasterDataUrl,
} from '../../shared/nodeslide';
import { type SlideContentShape, chooseDeckArchetypes } from '../../shared/nodeslideArchetypes';
import type { NodeSlideNativeArtifactGeometry } from '../../shared/nodeslideArtifactGeometry.js';
import {
  NODESLIDE_AUTHORED_ARTIFACT_BINDING_VERSION,
  type NodeSlideAuthoredArtifactBinding,
  nodeSlideArtifactDigest,
} from '../../shared/nodeslideArtifactSpec';
import {
  type NodeSlideDataAttachment,
  nodeSlideDataAttachmentShape,
} from '../../shared/nodeslideAttachments';
import {
  estimateTextHeight,
  resolveCollisions,
  stackBlocks,
} from '../../shared/nodeslideLayoutMetrics';
import {
  NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
  type NodeSlideAuthoredArtifactReceipt,
  type NodeSlideAuthoredArtifactSpec,
  compileNodeSlideAuthoredArtifact,
  nodeSlideAuthoredArtifactLinkedUrls,
  nodeSlideAuthoredArtifactReceiptLineageMatches,
  nodeSlideAuthoredArtifactSourceInventory,
  nodeSlideAuthoredArtifactValidationOptions,
} from './nodeslideAuthoredArtifact';
import {
  type NodeSlideCompositionCandidateSummary,
  fanOutNodeSlideComposition,
} from './nodeslideCompositionFanout';
import { type NodeSlideDesignPlan, buildNodeSlideDesignPlans } from './nodeslideDesignPlan';
import {
  nodeslideCleanText,
  nodeslideContentDigest,
  nodeslideHash,
  nodeslideSlug,
  nodeslideStableId,
} from './nodeslideIds';
import {
  type NodeSlideStorySpec,
  type NodeSlideVisualMaterialInventory,
  buildNodeSlideStoryContext,
} from './nodeslideStoryContext';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

export interface NodeSlidePlannedChart {
  labels: string[];
  values: number[];
  unit?: string;
}

export interface NodeSlidePlannedDiagramNode {
  id: string;
  label: string;
  kind?: 'step' | 'system' | 'decision' | 'milestone';
}

export interface NodeSlidePlannedDiagramEdge {
  from: string;
  to: string;
  label?: string;
}

/** Structured, editable relationships; never an ASCII-arrow text box. */
export interface NodeSlidePlannedDiagram {
  kind: 'process' | 'architecture' | 'timeline';
  direction: 'horizontal' | 'vertical';
  nodes: NodeSlidePlannedDiagramNode[];
  edges: NodeSlidePlannedDiagramEdge[];
}

export interface NodeSlidePlannedFormula {
  expression: string;
  display: string;
  variables: Array<{ label: string; value: number; unit?: string }>;
  syntax?: 'plain' | 'latex';
  description?: string;
}

export interface NodeSlidePlannedImage {
  url?: string;
  imageUrl?: string;
  altText: string;
  credit?: string;
  caption?: string;
}

export interface NodeSlidePlannedVideo {
  url: string;
  posterUrl?: string;
  title?: string;
  captionsUrl?: string;
  captionsLanguage?: string;
  startAtSeconds?: number;
  endAtSeconds?: number;
}

export interface NodeSlidePlannedSlide {
  title: string;
  section: string;
  headline: string;
  body: string;
  bullets: string[];
  metric?: string;
  metricLabel?: string;
  chart?: NodeSlidePlannedChart;
  diagram?: NodeSlidePlannedDiagram;
  formula?: NodeSlidePlannedFormula;
  image?: NodeSlidePlannedImage;
  video?: NodeSlidePlannedVideo;
  /** Canonical authoring input retained so deterministic specs use the typed compiler boundary. */
  artifactSpec?: NodeSlideAuthoredArtifactSpec;
  /** Present only when an additive model-authored typed artifact compiled successfully. */
  authoredArtifactCompilation?: NodeSlideAuthoredArtifactReceipt;
  /** Normalized model-authored spec retained in the persisted creation record. */
  authoredArtifactSpec?: NodeSlideAuthoredArtifactSpec;
  /** Canonical 100x100 native marks bound to the authored compiler receipt. */
  authoredArtifactGeometry?: NodeSlideNativeArtifactGeometry;
}

export interface NodeSlideDeckSpec {
  title: string;
  narrative: string[];
  slides: NodeSlidePlannedSlide[];
  /** Server-derived before composition; providers may consume but never author it. */
  storySpec?: NodeSlideStorySpec;
  /** Honest inventory: placeholders and missing assets are never counted as evidence. */
  materialInventory?: NodeSlideVisualMaterialInventory;
  /** Server-owned semantic and reference-bound plan for every slide. */
  designPlans?: NodeSlideDesignPlan[];
  /** Three-way composition comparison receipts for visually important slides. */
  compositionFanout?: NodeSlideCompositionCandidateSummary[];
}

export interface NodeSlideBuildResult {
  snapshot: DeckSnapshot;
  plan: string[];
  spec: NodeSlideDeckSpec;
}

export interface NodeSlideLegacyGoldenRepairResult {
  changed: boolean;
  snapshot: DeckSnapshot;
}

export interface BuildBriefDeckInput {
  deckId: string;
  projectId: string;
  title: string;
  brief: DeckBrief;
  themeId: string;
  rawSpec?: unknown;
  plan?: readonly string[];
  attachments?: readonly NodeSlideDataAttachment[];
  now: number;
}

const EDITABLE_CAPABILITIES = ['web_native', 'pptx_editable', 'google_importable'] as const;
const STATIC_MATH_CAPABILITIES = [
  'web_native',
  'pptx_static_fallback',
  'google_importable',
] as const;

const FALLBACK_LIGHT_THEME: ThemeSpec = {
  id: 'editorial-signal',
  name: 'Editorial Signal',
  mode: 'light',
  colors: {
    canvas: '#F5F1E8',
    ink: '#14231C',
    muted: '#5F6B64',
    accent: '#B44A2D',
    accentSoft: '#F8D8CC',
    insight: '#DCEBDD',
    insightInk: '#17442D',
    trace: '#6B5BD2',
    border: '#D8D1C5',
  },
  typography: {
    display: 'Fraunces Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 18,
  spacingUnit: 8,
};

const FALLBACK_DARK_THEME: ThemeSpec = {
  id: 'midnight-signal',
  name: 'Midnight Signal',
  mode: 'dark',
  colors: {
    canvas: '#111815',
    ink: '#F5F1E8',
    muted: '#A7B2AB',
    accent: '#FF7655',
    accentSoft: '#42271F',
    insight: '#193E2B',
    insightInk: '#C8F3D6',
    trace: '#9E8CFF',
    border: '#344139',
  },
  typography: {
    display: 'Fraunces Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 18,
  spacingUnit: 8,
};

const THEME_EDITORIAL_SIGNAL: ThemeSpec = {
  id: 'editorial-signal',
  name: 'Editorial Signal',
  mode: 'light',
  colors: {
    canvas: '#F7F4ED',
    ink: '#26221D',
    muted: '#756B61',
    accent: '#B44A2D',
    accentSoft: '#F2DED3',
    insight: '#E5E9D6',
    insightInk: '#34452C',
    trace: '#7566A8',
    border: '#DED7CC',
  },
  typography: {
    display: 'Fraunces Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 18,
  spacingUnit: 8,
};

const THEME_QUIET_PRECISION: ThemeSpec = {
  id: 'quiet-precision',
  name: 'Quiet Precision',
  mode: 'light',
  colors: {
    canvas: '#F4F7F8',
    ink: '#17242B',
    muted: '#60727B',
    accent: '#287A8D',
    accentSoft: '#DCECF0',
    insight: '#DDEDE8',
    insightInk: '#15554E',
    trace: '#4E6E8E',
    border: '#CFDCE0',
  },
  typography: {
    display: 'Geist Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 8,
  spacingUnit: 8,
};

const THEME_NIGHT_BRIEFING: ThemeSpec = {
  id: 'night-briefing',
  name: 'Night Briefing',
  mode: 'dark',
  colors: {
    canvas: '#15171C',
    ink: '#F4F1E9',
    muted: '#A9AFBA',
    accent: '#B8E068',
    accentSoft: '#2B331F',
    insight: '#334022',
    insightInk: '#E4FFAA',
    trace: '#8DA2FF',
    border: '#353A43',
  },
  typography: {
    display: 'Geist Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 10,
  spacingUnit: 8,
};

const DESIGN_PROFILE_THEMES: Readonly<Record<string, ThemeSpec>> = {
  [THEME_EDITORIAL_SIGNAL.id]: THEME_EDITORIAL_SIGNAL,
  [THEME_QUIET_PRECISION.id]: THEME_QUIET_PRECISION,
  [THEME_NIGHT_BRIEFING.id]: THEME_NIGHT_BRIEFING,
};

export function nodeslideTheme(themeId: string): ThemeSpec {
  const cleanId = nodeslideSlug(themeId);
  const profile = DESIGN_PROFILE_THEMES[cleanId];
  if (profile) return structuredClone(profile);

  const dark = /dark|midnight|night|black/i.test(themeId);
  const base = structuredClone(dark ? FALLBACK_DARK_THEME : FALLBACK_LIGHT_THEME);
  if (cleanId && cleanId !== 'deck') base.id = cleanId;
  return base;
}

export function repairLegacyGoldenSnapshot(
  snapshot: DeckSnapshot,
  canonical: DeckSnapshot,
): NodeSlideLegacyGoldenRepairResult {
  if (!isMatchingCanonicalGolden(snapshot, canonical)) {
    return { changed: false, snapshot };
  }

  const canonicalElements = new Map(canonical.elements.map((element) => [element.id, element]));
  let repaired: DeckSnapshot | undefined;
  const currentSnapshot = () => repaired ?? snapshot;
  const replaceElement = (index: number, element: SlideElement) => {
    if (!repaired) repaired = structuredClone(snapshot);
    repaired.elements[index] = element;
  };

  for (let index = 0; index < snapshot.elements.length; index += 1) {
    const current = currentSnapshot().elements[index];
    if (!current) continue;
    const expected = canonicalElements.get(current.id);
    const mathMatches = stableJson(current.math) === stableJson(expected?.math);
    const capabilitiesMatch =
      stableJson(current.exportCapabilities) === stableJson(expected?.exportCapabilities);
    if (
      !expected ||
      (!isUntouchedCanonicalElementIdentity(current, expected) &&
        !isCanonicalMathWithLegacyCapabilityDeclaration(current, expected)) ||
      current.kind !== 'math' ||
      expected.kind !== 'math' ||
      !expected.math ||
      (mathMatches && capabilitiesMatch)
    ) {
      continue;
    }

    replaceElement(index, {
      ...current,
      ...(expected.content !== undefined ? { content: expected.content } : {}),
      math: structuredClone(expected.math),
      exportCapabilities: [...expected.exportCapabilities],
    });
  }

  for (let index = 0; index < snapshot.elements.length; index += 1) {
    const current = currentSnapshot().elements[index];
    if (!current) continue;
    const expected = canonicalElements.get(current.id);
    if (!expected || !isUntouchedCanonicalElementIdentity(current, expected)) continue;
    if (!isLegacyDuplicatedNumberedBullet(current, expected)) continue;

    replaceElement(index, { ...current, content: expected.content ?? '' });
  }

  if (geometryValidationIssueCount(canonical) === 0) {
    for (let index = 0; index < snapshot.elements.length; index += 1) {
      const working = currentSnapshot();
      const current = working.elements[index];
      if (!current) continue;
      const expected = canonicalElements.get(current.id);
      if (
        !expected ||
        !isUntouchedCanonicalElementIdentity(current, expected) ||
        sameBoundingBox(current.bbox, expected.bbox)
      ) {
        continue;
      }

      const issueCount = geometryValidationIssueCount(working);
      if (issueCount === 0) break;
      const trialElements = [...working.elements];
      trialElements[index] = { ...current, bbox: structuredClone(expected.bbox) };
      const trial = { ...working, elements: trialElements };
      if (geometryValidationIssueCount(trial) >= issueCount) continue;

      replaceElement(index, trialElements[index] as SlideElement);
    }
  }

  return repaired ? { changed: true, snapshot: repaired } : { changed: false, snapshot };
}

export function buildGoldenNodeSlide(clientSessionId: string, now: number): NodeSlideBuildResult {
  const sessionKey = nodeslideHash(clientSessionId.trim());
  const deckId = `deck_golden_${sessionKey}`;
  const projectId = `project_nodeslide_${sessionKey}`;
  const brief: DeckBrief = {
    prompt:
      'Show how NodeSlide turns presentation work into a traceable, editable, reviewable system.',
    audience: 'Product, design, and engineering leaders evaluating a new presentation workflow',
    purpose: 'Demonstrate the NodeSlide product story with a credible, polished golden deck',
    successCriteria: [
      'Make the product promise obvious in the first minute',
      'Make workflow value legible without inventing evidence',
      'Explain guarded agent edits, review, and version recovery',
    ],
  };
  const spec: NodeSlideDeckSpec = {
    title: 'NodeSlide — stories with structure',
    narrative: [
      'Presentation work should be editable data, not a pile of pixels.',
      'Typed structure makes every agent change reviewable and reversible.',
      'A source-aware workflow can move quickly without losing trust.',
    ],
    slides: [
      {
        title: 'Stories with structure',
        section: 'NodeSlide / 01',
        headline: 'Build the story. Keep every decision editable.',
        body: 'NodeSlide treats a deck as a typed system: narrative, geometry, sources, comments, and changes stay connected from first brief to final room.',
        bullets: ['Structured canvas', 'Guarded edits', 'Traceable claims'],
      },
      {
        title: 'The handoff tax compounds',
        section: 'Scenario / 02',
        headline: 'Keep source context attached as the story moves.',
        body: 'This golden scenario focuses on one design goal: keep copy, layout, citations, and feedback connected through drafting, review, revision, and handoff.',
        bullets: [
          'Draft with source context',
          'Review on stable anchors',
          'Hand off editable structure',
        ],
        metric: 'CONTEXT',
        metricLabel: 'Qualitative workflow label — not a measured benchmark',
      },
      {
        title: 'A deck is a typed system',
        section: 'Foundation / 03',
        headline: 'Structure turns a visual artifact into an operating surface.',
        body: 'Slides and elements carry stable IDs, normalized geometry, source links, export capability, locks, and independent versions.',
        bullets: [
          'Stable IDs survive every view',
          'Normalized boxes travel across renderers',
          'Locks protect intent',
        ],
        image: {
          altText: 'Structured deck graph connecting slides, elements, sources, and versions',
          caption: 'A canonical deck graph keeps every artifact connected.',
        },
      },
      {
        title: 'One intent, three guarded passes',
        section: 'Workflow / 04',
        headline: 'Plan → propose → commit, with scope checked at every boundary.',
        body: 'The agent can reason broadly, but it may only write inside the explicit deck, slide, element, comment, or bounding-box scope.',
        bullets: ['Read context', 'Propose an inspectable patch', 'Validate and accept atomically'],
        formula: {
          expression:
            '\\text{authorized change} = \\text{requested scope} \\cap \\text{allowed scope}',
          display: 'authorized change = requested scope ∩ allowed scope',
          variables: [],
          syntax: 'latex',
          description:
            'The agent can only mutate the intersection of requested and authorized scope.',
        },
      },
      {
        title: 'Quality is measurable',
        section: 'Proof / 05',
        headline: 'A beautiful deck still needs deterministic gates.',
        body: 'Structural, geometry, source, and export checks produce separate signals for basic validity, publishing safety, and a clean handoff.',
        bullets: [
          'ok · structurally valid',
          'publishOk · safe to present',
          'cleanOk · no warnings',
        ],
        metric: '3 gates',
        metricLabel: 'independent validation signals: ok, publishOk, cleanOk',
        chart: {
          labels: ['ok', 'publish', 'clean'],
          values: [1, 1, 1],
          unit: 'pass',
        },
      },
      {
        title: 'Human review stays in the loop',
        section: 'Trust / 06',
        headline: 'Comments become context. Patches remain choices.',
        body: 'A reviewer can anchor feedback to a deck, slide, element, or region; link the resolution to an accepted patch; and restore any prior snapshot.',
        bullets: ['Anchored discussion', 'Compare-and-set acceptance', 'Version recovery'],
      },
      {
        title: 'Ship the story, keep the structure',
        section: 'Next / 07',
        headline: 'Move at presentation speed without giving up engineering-grade trust.',
        body: 'Start with a brief, shape the narrative together, and leave with a deck whose content, sources, changes, and exports are still yours.',
        bullets: ['Create from brief', 'Review every change', 'Present with confidence'],
      },
    ],
  };
  const plan = [
    'Open with the promise: storytelling speed without structural loss.',
    'Frame context continuity as the qualitative workflow goal.',
    'Reveal the typed deck model as the foundation.',
    'Demonstrate the scoped plan–propose–commit workflow.',
    'Prove quality with deterministic validation gates.',
    'Make human review, comments, and restore explicit.',
    'Close on the durable outcome and a clear invitation.',
  ];
  return buildNodeSlideDeck({
    deckId,
    projectId,
    title: spec.title,
    brief,
    themeId: THEME_EDITORIAL_SIGNAL.id,
    spec,
    plan,
    now,
    shareSlug: nodeslideSlug('nodeslide-stories-with-structure', sessionKey),
    golden: true,
  });
}

export function deterministicBriefSpec(
  title: string,
  brief: DeckBrief,
  attachments: readonly NodeSlideDataAttachment[] = [],
): NodeSlideDeckSpec {
  const cleanTitle = nodeslideCleanText(title, 80) || 'Untitled story';
  const audience = nodeslideCleanText(brief.audience, 120) || 'the audience';
  const purpose = nodeslideCleanText(brief.purpose, 180) || nodeslideCleanText(brief.prompt, 180);
  const outcome = sentenceCase(purpose || nodeslideCleanText(brief.prompt, 180));
  const criteria = brief.successCriteria
    .map((criterion) => nodeslideCleanText(criterion, 96))
    .filter(Boolean)
    .slice(0, 3);
  const success =
    criteria.length > 0 ? criteria : ['Make the decision clear', 'Show credible evidence'];
  const successSourceRefs = criteria.length > 0 ? ['brief:success-criteria'] : [];
  const successArtifact = compileNodeSlideAuthoredArtifact(
    {
      schemaVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
      id: 'deterministic-success-signals',
      kind: 'chart',
      narrativeJob: 'Show the brief-defined success signals as an explicit evaluation checklist.',
      claimIds: [],
      sourceIds: [...successSourceRefs],
      provenance: {
        truthState: criteria.length > 0 ? 'derived' : 'illustrative',
        rationale:
          criteria.length > 0
            ? 'Each equal-height bar represents one success criterion supplied in the brief.'
            : 'No success criteria were supplied, so the equal-height bars are an illustrative default checklist rather than measured evidence.',
        sourceRefs: [...successSourceRefs],
      },
      payload: {
        unit: 'defined',
        xAxis: { labels: success.map((_, index) => `S${index + 1}`) },
        yAxis: { min: 0, max: 1 },
        series: [{ id: 'defined-signals', values: success.map(() => 1) }],
      },
    },
    nodeSlideAuthoredArtifactValidationOptions(
      nodeSlideAuthoredArtifactSourceInventory(brief, attachments),
    ),
  );

  const spec: NodeSlideDeckSpec = {
    title: cleanTitle,
    narrative: [
      `Orient ${audience} around the central promise.`,
      'Move from current tension to a concrete, credible approach.',
      'Close with proof, ownership, and a specific next move.',
    ],
    slides: [
      {
        title: cleanTitle,
        section: 'Opening / 01',
        headline: outcome,
        body: `A focused narrative for ${audience}, built from the supplied brief and kept editable from first draft onward.`,
        bullets: success,
      },
      {
        title: 'The moment to solve',
        section: 'Context / 02',
        headline: 'The cost of waiting is usually hidden in repeated work.',
        body: `Frame the current reality for ${audience}: what is fragmented today, why it matters now, and where momentum is being lost.`,
        bullets: ['Name the friction', 'Expose the consequence', 'Create urgency without hype'],
        diagram: {
          kind: 'process',
          direction: 'horizontal',
          nodes: [
            { id: 'friction', label: 'Friction', kind: 'step' },
            { id: 'consequence', label: 'Consequence', kind: 'step' },
            { id: 'urgency', label: 'Decision window', kind: 'milestone' },
          ],
          edges: [
            { from: 'friction', to: 'consequence' },
            { from: 'consequence', to: 'urgency' },
          ],
        },
      },
      {
        title: 'The decisive insight',
        section: 'Insight / 03',
        headline: 'A better outcome starts with a sharper point of view.',
        body: nodeslideCleanText(brief.prompt, 260),
        bullets: success,
      },
      {
        title: 'How the approach works',
        section: 'Approach / 04',
        headline: 'Turn the idea into a sequence people can understand and own.',
        body: 'Connect intent, action, and feedback in one visible operating path so the audience can see both the destination and the mechanics.',
        bullets: ['Align on intent', 'Execute the critical moves', 'Review measurable outcomes'],
        formula: {
          expression: 'accepted change = proposal ∩ authorized scope',
          display: 'accepted change = proposal ∩ authorized scope',
          variables: [],
          syntax: 'plain',
          description: 'Only the authorized portion of a proposal may be accepted.',
        },
      },
      {
        title: 'What success looks like',
        section: 'Evidence / 05',
        headline: 'Define proof before asking for commitment.',
        body: 'Use the brief’s success criteria as explicit evaluation signals, with assumptions clearly separated from measured evidence.',
        bullets: success,
        metric: `${success.length} signals`,
        metricLabel: 'agreed measures of a successful outcome',
        artifactSpec: successArtifact.spec,
        ...successArtifact.planned,
        authoredArtifactCompilation: successArtifact.receipt,
        authoredArtifactSpec: successArtifact.spec,
        ...(successArtifact.geometry ? { authoredArtifactGeometry: successArtifact.geometry } : {}),
      },
      {
        title: 'A practical path forward',
        section: 'Delivery / 06',
        headline: 'Start narrow, learn quickly, and preserve room to adapt.',
        body: 'Sequence the work into a focused launch, an evidence review, and a deliberate scale decision with named ownership at every step.',
        bullets: [
          'Launch the smallest credible move',
          'Review evidence with stakeholders',
          'Scale what earns confidence',
        ],
        image: {
          altText: 'Structured evidence map derived from the supplied brief',
          caption: 'The visual is illustrative and remains replaceable as an image object.',
        },
      },
      {
        title: 'The decision',
        section: 'Close / 07',
        headline: outcome || 'Choose the next move and make ownership explicit.',
        body: `Invite ${audience} to align on the outcome, the first action, and the evidence that will guide the next decision.`,
        bullets: ['Agree the outcome', 'Name the owner', 'Set the next checkpoint'],
      },
    ],
    ...buildNodeSlideStoryContext({ title: cleanTitle, brief, attachments }),
  };
  applyDeterministicBriefPrimitives(spec.slides, brief.prompt);
  spec.designPlans = buildNodeSlideDesignPlans({
    slides: spec.slides,
    ...(spec.storySpec ? { storySpec: spec.storySpec } : {}),
  });
  return spec;
}

function applyDeterministicBriefPrimitives(slides: NodeSlidePlannedSlide[], prompt: string): void {
  const csvRecords = briefMetricCsvRecords(prompt);
  const csvByMetric = new Map(csvRecords.map((record) => [record.metric, record]));
  const totalGoals = Number(csvByMetric.get('total_goals')?.value);
  const matchesPlayed = Number(csvByMetric.get('matches_played')?.value);
  const suppliedGoalsPerMatch = Number(csvByMetric.get('goals_per_match')?.value);
  const contextSlide = slides[1];
  const derivedSlide = slides[2];
  if (
    Number.isFinite(totalGoals) &&
    Number.isFinite(matchesPlayed) &&
    matchesPlayed > 0 &&
    contextSlide &&
    derivedSlide
  ) {
    const goalsPerMatch = Number.isFinite(suppliedGoalsPerMatch)
      ? suppliedGoalsPerMatch
      : Number((totalGoals / matchesPlayed).toFixed(2));
    contextSlide.title = 'Tournament at a glance';
    contextSlide.headline = `${totalGoals} goals across ${matchesPlayed} matches.`;
    contextSlide.body =
      'The uploaded tournament data is compiled into editable metrics, not flattened into an image.';
    contextSlide.bullets = [
      `Average: ${goalsPerMatch} goals per match`,
      'Every value remains linked to the uploaded source',
      'Review or replace the data without rebuilding the slide',
    ];
    contextSlide.metric = String(totalGoals);
    contextSlide.metricLabel = 'total goals in the supplied dataset';
    derivedSlide.title = 'Scoring rate';
    derivedSlide.headline = `${goalsPerMatch} goals per match.`;
    derivedSlide.body =
      'NodeSlide keeps the result and both inputs as a structured formula for review and native export.';
    derivedSlide.bullets = ['Editable numerator', 'Editable denominator', 'Recomputable result'];
    derivedSlide.formula = {
      expression: 'total_goals / matches_played',
      display: `${totalGoals} ÷ ${matchesPlayed} = ${goalsPerMatch}`,
      variables: [
        { label: 'Total goals', value: totalGoals, unit: 'goals' },
        { label: 'Matches played', value: matchesPlayed, unit: 'matches' },
      ],
      syntax: 'plain',
      description: 'Goals per match derived from the uploaded tournament totals.',
    };
  }
  const scorerRecords = ['top_scorer', 'runner_up'].flatMap((metric) => {
    const record = csvByMetric.get(metric);
    if (!record) return [];
    const goals = Number(record.unit.match(/\d+(?:\.\d+)?/u)?.[0]);
    return record.value && Number.isFinite(goals) ? [{ label: record.value, value: goals }] : [];
  });
  const csvChartRecords =
    scorerRecords.length >= 2
      ? scorerRecords
      : csvRecords.flatMap((record) => {
          const value = Number(record.value);
          return Number.isFinite(value) ? [{ label: humanizeMetric(record.metric), value }] : [];
        });
  const csvChartSlide = slides[3];
  if (csvChartRecords.length >= 2 && csvChartSlide) {
    const { formula: _formula, ...chartOnlySlide } = csvChartSlide;
    slides[3] = {
      ...chartOnlySlide,
      title: scorerRecords.length >= 2 ? 'Golden Boot race' : 'Uploaded comparison',
      headline:
        scorerRecords.length >= 2
          ? 'The top two scorers were separated by one goal.'
          : 'The uploaded values remain an editable chart.',
      body: 'Labels and values stay in the canonical deck spec for direct editing, validation, and native export.',
      bullets: ['Data-bound bars', 'Source-linked values', 'Editable labels'],
      chart: {
        labels: csvChartRecords.slice(0, 8).map(({ label }) => label),
        values: csvChartRecords.slice(0, 8).map(({ value }) => value),
        unit: scorerRecords.length >= 2 ? 'goals' : 'value',
      },
    };
  }

  const formulaMatch = prompt.match(
    /formula[^.;]{0,40}?(\d+(?:\.\d+)?)\s*(?:÷|\/)\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)([^,.;]*)/iu,
  );
  const formulaSlide = slides[2];
  if (formulaMatch && formulaSlide) {
    const numerator = Number(formulaMatch[1]);
    const denominator = Number(formulaMatch[2]);
    const result = Number(formulaMatch[3]);
    const suffix = nodeslideCleanText(
      (formulaMatch[4] ?? '').split(/\s+and\s+an?\s+editable\b/iu)[0] ?? '',
      80,
    );
    const display = `${numerator} ÷ ${denominator} = ${result}${suffix ? ` ${suffix}` : ''}`;
    formulaSlide.title = 'Derived measure';
    formulaSlide.headline = display;
    formulaSlide.body =
      'This formula remains structured with editable inputs, a presentation value, and linked evidence.';
    formulaSlide.formula = {
      expression: `${numerator} / ${denominator}`,
      display,
      variables: [
        { label: 'Numerator', value: numerator },
        { label: 'Denominator', value: denominator },
      ],
    };
  }

  const comparisonText = prompt.match(/top scorers were\s+([^.;]+)/iu)?.[1];
  const comparisons = comparisonText
    ? comparisonText.split(/,\s*(?:and\s+)?|\s+and\s+/iu).flatMap((part) => {
        const match = part.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)$/u);
        if (!match) return [];
        const label = nodeslideCleanText(match[1] ?? '', 60);
        const value = Number(match[2]);
        return label && Number.isFinite(value) ? [{ label, value }] : [];
      })
    : [];
  const chartSlide = slides[3];
  if (comparisons.length >= 2 && chartSlide) {
    const { formula: _formula, ...chartOnlySlide } = chartSlide;
    slides[3] = {
      ...chartOnlySlide,
      title: 'Supplied comparison',
      headline: 'The supplied values remain an editable chart.',
      body: 'Labels and values stay in the canonical deck spec for direct editing and native export.',
      chart: {
        labels: comparisons.slice(0, 8).map(({ label }) => label),
        values: comparisons.slice(0, 8).map(({ value }) => value),
        unit: 'goals',
      },
    };
  }

  const imageLabel = nodeslideCleanText(
    prompt.match(/editable\s+([^.;]{3,80}?)\s+image placeholder/iu)?.[1] ?? '',
    80,
  );
  const imageSlide = slides.find((slide) => slide.image) ?? slides[5];
  if (imageLabel && imageSlide) {
    imageSlide.title = `${imageLabel} image placeholder`;
    imageSlide.headline = 'Missing image evidence stays explicit, editable, and credited.';
    imageSlide.body =
      'NodeSlide keeps an honest replace-image primitive until a licensed asset is supplied.';
    imageSlide.image = {
      altText: `${imageLabel} — replace with a licensed image`,
      credit: 'Licensed image and visible credit required before external use',
    };
  }
}

function briefMetricCsvRecords(
  prompt: string,
): Array<{ metric: string; value: string; unit: string }> {
  const lines = prompt.split(/\r?\n/u);
  const headerIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === 'metric,value,unit,source',
  );
  if (headerIndex < 0) return [];
  return lines.slice(headerIndex + 1, headerIndex + 101).flatMap((line) => {
    const [rawMetric = '', rawValue = '', rawUnit = ''] = line.split(',');
    const metric = rawMetric.trim().toLowerCase();
    const value = rawValue.trim();
    const unit = rawUnit.trim();
    return /^[a-z0-9_ -]{1,80}$/u.test(metric) && value
      ? [{ metric: metric.replace(/[ -]+/gu, '_'), value, unit }]
      : [];
  });
}

function humanizeMetric(metric: string): string {
  return metric
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toLocaleUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function sentenceCase(value: string): string {
  const characters = Array.from(value);
  if (characters.length === 0) return '';
  return `${characters[0]?.toLocaleUpperCase() ?? ''}${characters.slice(1).join('')}`;
}

export function coerceBriefSpec(
  rawSpec: unknown,
  title: string,
  brief: DeckBrief,
  attachments: readonly NodeSlideDataAttachment[] = [],
): NodeSlideDeckSpec {
  const fallback = deterministicBriefSpec(title, brief, attachments);
  if (!isRecord(rawSpec) || !Array.isArray(rawSpec.slides)) return fallback;
  const artifactValidationOptions = nodeSlideAuthoredArtifactValidationOptions(
    nodeSlideAuthoredArtifactSourceInventory(brief, attachments),
  );
  const slides = rawSpec.slides
    .map((value, index) =>
      coercePlannedSlide(value, fallback.slides[index], index, artifactValidationOptions),
    )
    .filter((slide): slide is NodeSlidePlannedSlide => slide !== null)
    .slice(0, 8);
  if (slides.length < 6) return fallback;

  const narrative = Array.isArray(rawSpec.narrative)
    ? rawSpec.narrative
        .filter((value): value is string => typeof value === 'string')
        .map((value) => nodeslideCleanText(value, 180))
        .filter(Boolean)
        .slice(0, 5)
    : fallback.narrative;
  const storyContext = buildNodeSlideStoryContext({ title, brief, attachments });
  const spec: NodeSlideDeckSpec = {
    title:
      typeof rawSpec.title === 'string'
        ? nodeslideCleanText(rawSpec.title, 80) || fallback.title
        : fallback.title,
    narrative: narrative.length > 0 ? narrative : fallback.narrative,
    slides,
    ...storyContext,
  };
  spec.designPlans = buildNodeSlideDesignPlans({
    slides: spec.slides,
    storySpec: storyContext.storySpec,
  });
  return spec;
}

export function buildBriefNodeSlide(input: BuildBriefDeckInput): NodeSlideBuildResult {
  const spec = coerceBriefSpec(input.rawSpec, input.title, input.brief, input.attachments ?? []);
  const fallbackPlan = spec.slides.map(
    (slide, index) => `${index + 1}. ${slide.section}: ${slide.headline}`,
  );
  const plan = (input.plan ?? fallbackPlan)
    .map((step) => nodeslideCleanText(step, 220))
    .filter(Boolean)
    .slice(0, 12);
  return buildNodeSlideDeck({
    deckId: input.deckId,
    projectId: input.projectId,
    title: nodeslideCleanText(input.title, 80) || spec.title,
    brief: input.brief,
    themeId: input.themeId,
    spec,
    plan: plan.length > 0 ? plan : fallbackPlan,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    now: input.now,
    shareSlug: nodeslideSlug(input.title, nodeslideHash(input.deckId)),
    golden: false,
  });
}

function buildNodeSlideDeck(input: {
  deckId: string;
  projectId: string;
  title: string;
  brief: DeckBrief;
  themeId: string;
  spec: NodeSlideDeckSpec;
  plan: string[];
  attachments?: readonly NodeSlideDataAttachment[];
  now: number;
  shareSlug: string;
  golden: boolean;
}): NodeSlideBuildResult {
  const theme = nodeslideTheme(input.themeId);
  const sourceBriefId = nodeslideStableId('source', input.deckId, 'brief');
  const sourceEvidenceId = nodeslideStableId('source', input.deckId, 'evidence');
  const linkedSources = linkedBriefSources(input.deckId, input.brief.prompt, input.now);
  const uploadedSources: SourceRecord[] = (input.attachments ?? []).map((attachment) => {
    const sourceType =
      attachment.format === 'csv'
        ? ('spreadsheet' as const)
        : attachment.format === 'json'
          ? ('document' as const)
          : ('note' as const);
    return {
      id: nodeslideStableId(
        'source',
        input.deckId,
        sourceType,
        attachment.title,
        nodeslideHash(attachment.content),
      ),
      deckId: input.deckId,
      title: attachment.title,
      sourceType,
      retrievedAt: input.now,
      citation: `Uploaded file: ${attachment.title}\n${attachment.content}`,
      license: 'User supplied',
      format: attachment.format,
      contentDigest: nodeslideContentDigest(attachment.content),
      byteSize: new TextEncoder().encode(attachment.content).byteLength,
      ...nodeSlideDataAttachmentShape(attachment.content, attachment.format),
      retention: 'until_deleted',
      status: 'ready',
      lastRefreshedAt: input.now,
    };
  });
  const linkedSourceIds = [...linkedSources, ...uploadedSources].map((source) => source.id);
  const authoredSourceIdByRef = new Map<string, string>([
    ['brief:prompt', sourceBriefId],
    ['brief:success-criteria', sourceEvidenceId],
    ...uploadedSources.map((source, index) => [`attachment:${index + 1}`, source.id] as const),
    ...linkedSources.map((source, index) => [`link:${index + 1}`, source.id] as const),
  ]);
  const sources: SourceRecord[] = [
    {
      id: sourceBriefId,
      deckId: input.deckId,
      title: input.golden ? 'NodeSlide product brief' : `${input.title} — creation brief`,
      sourceType: 'internal',
      retrievedAt: input.now,
      citation: input.brief.prompt,
      license: 'Internal working material',
    },
    {
      id: sourceEvidenceId,
      deckId: input.deckId,
      title: input.golden ? 'Golden workflow scenario' : 'Brief success criteria',
      sourceType: 'note',
      retrievedAt: input.now,
      citation: input.golden
        ? 'Qualitative product-workflow scenario for demonstrating NodeSlide; no measured customer benchmark is claimed.'
        : input.brief.successCriteria.join('; ') || 'No explicit success criteria supplied.',
      license: 'Internal working material',
    },
    ...linkedSources,
    ...uploadedSources,
  ];

  // Archetype selection runs over the whole deck first so the anti-monotony
  // rule can see adjacency: an alternative layout is preferred whenever the
  // content shape allows one and the previous slide used the same archetype.
  const contentShapes: SlideContentShape[] = input.spec.slides.map((planned, index) => ({
    index,
    total: input.spec.slides.length,
    hasMetric: planned.metric !== undefined,
    hasChart: planned.chart !== undefined,
    hasDiagram: planned.diagram !== undefined,
    hasMedia: planned.image !== undefined || planned.video !== undefined,
    hasFormula: planned.formula !== undefined,
    bulletCount: planned.bullets.filter(Boolean).length,
  }));
  const archetypes = chooseDeckArchetypes(contentShapes);

  const slides: Slide[] = [];
  const elements: SlideElement[] = [];
  const compositionFanout: NodeSlideCompositionCandidateSummary[] = [];
  for (let index = 0; index < input.spec.slides.length; index += 1) {
    const planned = input.spec.slides[index];
    if (!planned) continue;
    const slideId = nodeslideStableId('slide', input.deckId, String(index + 1), planned.title);
    const built = buildSlide({
      deckId: input.deckId,
      slideId,
      planned,
      archetype: archetypes[index] ?? 'split',
      index,
      total: input.spec.slides.length,
      theme,
      sourceBriefId,
      sourceEvidenceId,
      linkedSourceIds,
      authoredSourceIdByRef,
    });
    slides.push(built.slide);
    const designPlan = input.spec.designPlans?.[index];
    if (designPlan) {
      const fanout = fanOutNodeSlideComposition({ elements: built.elements, plan: designPlan });
      elements.push(...fanout.selectedElements);
      compositionFanout.push(...fanout.candidates);
    } else {
      elements.push(...built.elements);
    }
  }
  if (compositionFanout.length > 0) input.spec.compositionFanout = compositionFanout;

  const deck = {
    schemaVersion: NODESLIDE_SCHEMA_VERSION,
    toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
    id: input.deckId,
    projectId: input.projectId,
    title: input.title,
    brief: structuredClone(input.brief),
    theme,
    slideOrder: slides.map((slide) => slide.id),
    version: 1,
    status: 'ready' as const,
    shareSlug: input.shareSlug,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return {
    snapshot: { deck, slides, elements, sources },
    plan: input.plan,
    spec: input.spec,
  };
}

function buildSlide(input: {
  deckId: string;
  slideId: string;
  planned: NodeSlidePlannedSlide;
  archetype: SlideArchetype;
  index: number;
  total: number;
  theme: ThemeSpec;
  sourceBriefId: string;
  sourceEvidenceId: string;
  linkedSourceIds: string[];
  authoredSourceIdByRef: ReadonlyMap<string, string>;
}): { slide: Slide; elements: SlideElement[] } {
  const { planned, theme } = input;
  if (
    planned.authoredArtifactSpec &&
    planned.authoredArtifactCompilation &&
    !nodeSlideAuthoredArtifactReceiptLineageMatches(
      planned.authoredArtifactSpec,
      planned.authoredArtifactCompilation,
    )
  ) {
    throw new Error(
      'NodeSlide authored ArtifactSpec failed [artifact_receipt_lineage]: receipt does not bind the exact normalized spec.',
    );
  }
  if (
    (planned.authoredArtifactCompilation?.geometryDigest === undefined) !==
      (planned.authoredArtifactGeometry === undefined) ||
    (planned.authoredArtifactGeometry &&
      nodeSlideArtifactDigest(planned.authoredArtifactGeometry) !==
        planned.authoredArtifactCompilation?.geometryDigest)
  ) {
    throw new Error(
      'NodeSlide authored ArtifactSpec failed [artifact_geometry_lineage]: planned geometry does not match the compiler receipt.',
    );
  }
  const elements: SlideElement[] = [];
  const add = (element: SlideElement) => {
    elements.push(element);
    return element.id;
  };
  const element = (
    key: string,
    value: Omit<SlideElement, 'id' | 'slideId' | 'version'>,
  ): SlideElement => ({
    ...value,
    id: nodeslideStableId('element', input.slideId, key),
    slideId: input.slideId,
    version: 1,
  });

  add(
    element('accent-rail', {
      name: 'Accent rail',
      kind: 'shape',
      role: 'decoration',
      bbox: box(0.035, 0.065, 0.008, 0.83),
      rotation: 0,
      style: { fill: theme.colors.accent, radius: 8 },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  add(
    element('section', {
      name: 'Section label',
      kind: 'text',
      role: 'section',
      bbox: box(0.07, 0.065, 0.48, 0.05),
      rotation: 0,
      content: planned.section.toUpperCase(),
      style: {
        color: theme.colors.accent,
        fontFamily: theme.typography.data,
        fontSize: 15,
        fontWeight: 650,
        letterSpacing: 1.3,
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  const isOpening = input.index === 0;

  // Archetype-driven layout switches. Every archetype reuses the same
  // measurement helpers and ends in the same collision gate below.
  const { archetype } = input;
  const isStatement = archetype === 'statement';
  const isComparison = archetype === 'comparison';
  const isChartDominant = archetype === 'chart-dominant';
  const isDiagramDominant = archetype === 'diagram-dominant';
  // Media-dominant slides alternate sides by slide index for deck rhythm:
  // even index keeps the visual on the right, odd index moves it left.
  const mediaOnLeft = archetype === 'media-dominant' && input.index % 2 === 1;
  const copyX = mediaOnLeft ? 0.52 : 0.07;

  // Measured layout: heights derive from content (with the historical fixed
  // proportions kept as minimums) and blocks stack sequentially so long copy
  // pushes everything below it down instead of overlapping it.
  const headlineFontSize = isOpening ? 48 : 38;
  const headlineWidth = isOpening ? 0.79 : 0.76;
  const headlineY = 0.15;
  const headlineHeight = Math.min(
    isOpening ? 0.33 : 0.28,
    Math.max(
      isOpening ? 0.27 : 0.2,
      estimateTextHeight(planned.headline, headlineFontSize, 1.04, headlineWidth),
    ),
  );
  add(
    element('headline', {
      name: 'Headline',
      kind: 'text',
      role: isOpening ? 'title' : 'headline',
      bbox: box(0.07, headlineY, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize: headlineFontSize,
        fontWeight: 620,
        lineHeight: 1.04,
        letterSpacing: -0.8,
      },
      sourceIds: [input.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  const hasNativeArtifactGeometry = planned.authoredArtifactGeometry !== undefined;
  const hasPrimaryMedia =
    hasNativeArtifactGeometry ||
    planned.formula !== undefined ||
    planned.image !== undefined ||
    planned.video !== undefined ||
    planned.diagram !== undefined;
  const hasStructuredPrimitive = Boolean(planned.chart || hasPrimaryMedia);
  const hasVisual = hasStructuredPrimitive || planned.metric !== undefined;
  const claimSourceIds = [input.sourceBriefId, ...input.linkedSourceIds];
  const authoredSourceIds = planned.authoredArtifactCompilation?.sourceRefs.map((sourceRef) => {
    const sourceId = input.authoredSourceIdByRef.get(sourceRef);
    if (!sourceId) {
      throw new Error(
        `NodeSlide authored ArtifactSpec failed [artifact_source_binding]: unresolved source reference ${sourceRef}.`,
      );
    }
    return sourceId;
  });
  const evidenceSourceIds =
    authoredSourceIds ??
    (input.linkedSourceIds.length > 0 ? input.linkedSourceIds : [input.sourceEvidenceId]);
  const authoredArtifactBinding: NodeSlideAuthoredArtifactBinding | undefined =
    planned.authoredArtifactSpec && planned.authoredArtifactCompilation
      ? {
          schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_BINDING_VERSION,
          artifactId: planned.authoredArtifactSpec.id,
          kind: planned.authoredArtifactSpec.kind,
          narrativeJob: planned.authoredArtifactSpec.narrativeJob,
          truthState: planned.authoredArtifactSpec.provenance.truthState,
          rationale: planned.authoredArtifactSpec.provenance.rationale,
          claimIds: [...planned.authoredArtifactSpec.claimIds],
          sourceIds: evidenceSourceIds,
          specDigest: planned.authoredArtifactCompilation.authoredSpecDigest,
          projection: {
            ...planned.authoredArtifactCompilation.projection,
            knownFidelityDifferences: [
              ...planned.authoredArtifactCompilation.projection.knownFidelityDifferences,
            ],
          },
        }
      : undefined;
  const primaryEvidenceSourceId = evidenceSourceIds[0] ?? input.sourceEvidenceId;
  const bodyWidth = isComparison
    ? 0.79
    : isChartDominant
      ? 0.3
      : isDiagramDominant
        ? 0.32
        : mediaOnLeft
          ? 0.4
          : hasVisual
            ? 0.39
            : isStatement
              ? 0.66
              : 0.48;
  const horizontalBullets = isStatement;
  // The body starts below the measured headline; its own height is measured
  // from content (legacy proportions as minimums) and capped so the bullet
  // stack that follows it always stays above the footer band. Comparison
  // slides cap the body earlier to leave room for the three columns below.
  const bodyFontSize = isDiagramDominant ? 17 : 19;
  const bodyY = headlineY + headlineHeight + (isOpening ? 0.06 : isDiagramDominant ? 0.03 : 0.05);
  const bodyMaxBottom = isComparison
    ? 0.58
    : isDiagramDominant
      ? 0.56
      : hasVisual
        ? 0.7
        : horizontalBullets
          ? 0.78
          : 0.9;
  const bodyHeight = Math.min(
    Math.max(0.06, bodyMaxBottom - bodyY),
    Math.max(
      isOpening ? 0.17 : isDiagramDominant ? 0.16 : 0.2,
      estimateTextHeight(planned.body, bodyFontSize, 1.35, bodyWidth),
    ),
  );
  add(
    element('body', {
      name: 'Body copy',
      kind: 'text',
      role: 'body',
      bbox: box(copyX, bodyY, bodyWidth, bodyHeight),
      rotation: 0,
      content: planned.body,
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.body,
        fontSize: bodyFontSize,
        fontWeight: 430,
        lineHeight: 1.35,
      },
      sourceIds: claimSourceIds,
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );

  const bulletFontSize = horizontalBullets ? 16 : 17;
  const bulletX = horizontalBullets || isComparison ? 0.07 : hasVisual ? copyX : 0.59;
  const bulletWidth = horizontalBullets
    ? 0.25
    : isComparison
      ? 0.26
      : isChartDominant
        ? 0.3
        : isDiagramDominant
          ? 0.3
          : mediaOnLeft
            ? 0.4
            : hasVisual
              ? 0.39
              : 0.33;
  const bulletTexts = planned.bullets
    .slice(0, 3)
    .map((bullet, bulletIndex) => `${horizontalBullets ? '•' : `0${bulletIndex + 1}`}  ${bullet}`);
  const bulletHeights = bulletTexts.map((text) =>
    Math.max(
      horizontalBullets ? 0.08 : 0.09,
      estimateTextHeight(text, bulletFontSize, 1.2, bulletWidth),
    ),
  );
  // Horizontal rows sit on one line below the body; comparison slides place
  // each bullet in its own column on a shared row; vertical stacks begin
  // below the body (visual layouts) or beside it (right column) and are
  // compressed by stackBlocks if they would run past the footer band.
  const horizontalRowY = Math.min(0.9, Math.max(0.72, bodyY + bodyHeight + 0.03));
  const comparisonRowY = Math.min(0.7, bodyY + bodyHeight + 0.04);
  const bulletStackStart = isDiagramDominant
    ? Math.max(0.62, bodyY + bodyHeight + 0.04)
    : hasVisual
      ? bodyY + bodyHeight + 0.02
      : 0.42;
  const stackedBullets =
    horizontalBullets || isComparison
      ? []
      : stackBlocks(
          bulletStackStart,
          bulletHeights.map((height, bulletIndex) => ({
            key: `bullet-${bulletIndex + 1}`,
            height,
            gapBefore: 0.03,
          })),
          0.95,
        );
  bulletTexts.forEach((content, bulletIndex) => {
    const stacked = stackedBullets[bulletIndex];
    const bulletY = horizontalBullets
      ? horizontalRowY
      : isComparison
        ? comparisonRowY
        : (stacked?.y ?? bulletStackStart);
    const bulletHeight = horizontalBullets
      ? Math.min(bulletHeights[bulletIndex] ?? 0.08, 0.98 - horizontalRowY)
      : isComparison
        ? Math.min(Math.max(0.16, bulletHeights[bulletIndex] ?? 0.16), 0.9 - comparisonRowY)
        : (stacked?.height ?? 0.09);
    add(
      element(`bullet-${bulletIndex + 1}`, {
        name: `Key point ${bulletIndex + 1}`,
        kind: 'text',
        role: 'bullet',
        bbox: box(
          horizontalBullets
            ? bulletX + bulletIndex * 0.28
            : isComparison
              ? bulletX + bulletIndex * 0.29
              : bulletX,
          bulletY,
          bulletWidth,
          bulletHeight,
        ),
        rotation: 0,
        content,
        style: {
          color: theme.colors.ink,
          fontFamily: theme.typography.body,
          fontSize: bulletFontSize,
          fontWeight: 560,
          lineHeight: 1.2,
        },
        sourceIds: claimSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  });

  // Right-column primitives stack sequentially: the first keeps its legacy
  // anchor Y, later ones start below the previous block plus a gap, clamped
  // so nothing extends past the bottom of the slide.
  let rightColumnBottom: number | null = null;
  const placeRight = (
    defaultY: number,
    height: number,
    gapBefore = 0.03,
  ): { y: number; height: number } => {
    const y = Math.min(0.9, rightColumnBottom === null ? defaultY : rightColumnBottom + gapBefore);
    const clampedHeight = Math.min(height, 0.98 - y);
    rightColumnBottom = y + clampedHeight;
    return { y, height: clampedHeight };
  };

  // Stat-dominant slides without a chart give the metric the full right
  // column: a taller panel and a larger figure so the number carries the slide.
  const hugeMetric = archetype === 'stat-dominant' && !planned.chart;
  if (planned.metric && !hasPrimaryMedia) {
    const metricBox = placeRight(0.41, hugeMetric ? 0.2 : 0.15);
    add(
      element('metric', {
        name: 'Primary metric',
        kind: 'text',
        role: 'metric',
        bbox: box(0.56, metricBox.y, 0.34, metricBox.height),
        rotation: 0,
        content: planned.metric,
        style: {
          color: theme.colors.insightInk,
          fill: theme.colors.insight,
          fontFamily: theme.typography.data,
          fontSize: hugeMetric ? 56 : 43,
          fontWeight: 720,
          lineHeight: 1,
          padding: 20,
          radius: theme.defaultRadius,
        },
        sourceIds: evidenceSourceIds,
        ...(authoredArtifactBinding ? { authoredArtifactBinding } : {}),
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
    const metricLabelBox = placeRight(0.58, 0.09, 0.02);
    add(
      element('metric-label', {
        name: 'Metric label',
        kind: 'text',
        role: 'caption',
        bbox: box(0.59, metricLabelBox.y, 0.29, metricLabelBox.height),
        rotation: 0,
        content: planned.metricLabel ?? 'Success signal from the working brief',
        style: {
          color: theme.colors.muted,
          fontFamily: theme.typography.body,
          fontSize: 15,
          fontWeight: 500,
          lineHeight: 1.25,
          textAlign: 'center',
        },
        sourceIds: evidenceSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  }

  if (planned.formula) {
    const formulaBox = placeRight(0.42, 0.24);
    add(
      element('formula', {
        name: 'Editable formula',
        kind: 'math',
        role: 'formula',
        bbox: box(0.53, formulaBox.y, 0.39, formulaBox.height),
        rotation: 0,
        content: planned.formula.display,
        style: {
          fill: theme.colors.insight,
          color: theme.colors.insightInk,
          fontFamily: theme.typography.data,
          fontSize: 30,
          fontWeight: 720,
          lineHeight: 1.15,
          padding: 20,
          radius: theme.defaultRadius,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
        math: {
          expression: planned.formula.expression,
          display: planned.formula.display,
          variables: planned.formula.variables,
          syntax: planned.formula.syntax ?? 'plain',
          displayMode: 'block',
          ...(planned.formula.description ? { description: planned.formula.description } : {}),
          sourceId: primaryEvidenceSourceId,
        },
        sourceIds: evidenceSourceIds,
        ...(authoredArtifactBinding ? { authoredArtifactBinding } : {}),
        locked: false,
        exportCapabilities:
          planned.formula.syntax === 'latex'
            ? [...STATIC_MATH_CAPABILITIES]
            : [...EDITABLE_CAPABILITIES],
      }),
    );
  }

  // Media-dominant slides alternate the visual column; when the visual sits
  // on the left it anchors below the measured headline instead of the legacy
  // right-column Y so it never slides under the full-width headline.
  const mediaX = mediaOnLeft ? 0.06 : 0.53;
  const mediaAnchorY = (base: number) =>
    mediaOnLeft ? Math.max(base, headlineY + headlineHeight + 0.04) : base;

  if (planned.image) {
    const imageUrl = planned.image.imageUrl ?? planned.image.url;
    const hasEmbeddedAsset = isNodeSlideEmbeddedRasterDataUrl(imageUrl);
    const credit =
      planned.image.credit ??
      planned.image.caption ??
      'Credit required before external publication';
    const imageBox = placeRight(mediaAnchorY(0.39), 0.38);
    add(
      element('image', {
        name: 'Editable image',
        kind: 'image',
        role: 'image',
        bbox: box(mediaX, imageBox.y, 0.39, imageBox.height),
        rotation: 0,
        style: {
          fill: theme.colors.accentSoft,
          stroke: theme.colors.border,
          strokeWidth: 2,
          color: theme.colors.muted,
          radius: theme.defaultRadius,
        },
        image: {
          placeholder: !hasEmbeddedAsset,
          credit,
          sourceId: primaryEvidenceSourceId,
        },
        ...(hasEmbeddedAsset ? { imageUrl } : {}),
        altText: planned.image.altText,
        sourceIds: evidenceSourceIds,
        ...(authoredArtifactBinding ? { authoredArtifactBinding } : {}),
        locked: false,
        exportCapabilities: hasEmbeddedAsset
          ? ['web_native', 'pptx_static_fallback', 'google_importable']
          : [...EDITABLE_CAPABILITIES],
      }),
    );
    const imageCreditBox = placeRight(0.79, 0.07, 0.02);
    add(
      element('image-credit', {
        name: 'Image credit',
        kind: 'text',
        role: 'caption',
        bbox: box(mediaOnLeft ? 0.08 : 0.55, imageCreditBox.y, 0.35, imageCreditBox.height),
        rotation: 0,
        content: planned.image.caption
          ? planned.image.caption
          : `${hasEmbeddedAsset ? 'Image credit' : 'Replace image before external use'} · ${credit}`,
        style: {
          color: theme.colors.muted,
          fontFamily: theme.typography.body,
          fontSize: 14,
          fontWeight: 520,
          lineHeight: 1.2,
          textAlign: 'center',
        },
        sourceIds: evidenceSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  }

  if (planned.video) {
    const videoBox = placeRight(mediaAnchorY(0.4), 0.28);
    add(
      element('video', {
        name: 'Linked video',
        kind: 'video',
        role: 'evidence_video',
        bbox: box(mediaX, videoBox.y, 0.39, videoBox.height),
        rotation: 0,
        style: {
          fill: '#111318',
          stroke: theme.colors.border,
          strokeWidth: 1,
          radius: theme.defaultRadius,
        },
        video: {
          url: planned.video.url,
          ...(planned.video.posterUrl ? { posterUrl: planned.video.posterUrl } : {}),
          ...(planned.video.title ? { title: planned.video.title } : {}),
          ...(planned.video.captionsUrl ? { captionsUrl: planned.video.captionsUrl } : {}),
          ...(planned.video.captionsLanguage
            ? { captionsLanguage: planned.video.captionsLanguage }
            : {}),
          ...(planned.video.startAtSeconds !== undefined
            ? { startAtSeconds: planned.video.startAtSeconds }
            : {}),
          ...(planned.video.endAtSeconds !== undefined
            ? { endAtSeconds: planned.video.endAtSeconds }
            : {}),
        },
        altText: planned.video.title ?? 'Linked video',
        sourceIds: [input.sourceEvidenceId],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_static_fallback', 'google_importable'],
      }),
    );
  }

  if (planned.authoredArtifactGeometry && authoredArtifactBinding) {
    const geometry = planned.authoredArtifactGeometry;
    const stage = {
      x: 0.455,
      y: Math.max(0.43, headlineY + headlineHeight + 0.04),
      width: 0.475,
      height: Math.max(0.24, 0.87 - Math.max(0.43, headlineY + headlineHeight + 0.04)),
    };
    const nativeElements: SlideElement[] = [];
    type NativeElementDraft = Omit<
      SlideElement,
      | 'id'
      | 'slideId'
      | 'version'
      | 'sourceIds'
      | 'locked'
      | 'exportCapabilities'
      | 'authoredArtifactBinding'
      | 'groupId'
    >;
    const pushNative = (key: string, draft: NativeElementDraft) => {
      nativeElements.push(
        element(`native-${geometry.kind}-${key}`, {
          ...draft,
          sourceIds: evidenceSourceIds,
          authoredArtifactBinding,
          locked: false,
          exportCapabilities: [...EDITABLE_CAPABILITIES],
        }),
      );
    };
    const mapX = (value: number) => stage.x + (value / 100) * stage.width;
    const mapY = (value: number) => stage.y + (value / 100) * stage.height;
    const mapWidth = (value: number) => (value / 100) * stage.width;
    const mapHeight = (value: number) => (value / 100) * stage.height;
    const boundedNativeBox = (x: number, y: number, width: number, height: number): BoundingBox => {
      const boundedX = Math.max(stage.x, Math.min(stage.x + stage.width - 0.004, x));
      const boundedY = Math.max(stage.y, Math.min(stage.y + stage.height - 0.004, y));
      return box(
        boundedX,
        boundedY,
        Math.max(0.004, Math.min(width, stage.x + stage.width - boundedX)),
        Math.max(0.004, Math.min(height, stage.y + stage.height - boundedY)),
      );
    };
    const pushConnector = (
      key: string,
      name: string,
      role: string,
      from: { x: number; y: number } | null,
      to: { x: number; y: number } | null,
      strokeWidth = 2,
    ) => {
      if (!from || !to) return;
      const start = { x: mapX(from.x), y: mapY(from.y) };
      const end = { x: mapX(to.x), y: mapY(to.y) };
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const distance = Math.max(0.008, Math.hypot(deltaX, deltaY));
      pushNative(key, {
        name,
        kind: 'connector',
        role,
        bbox: boundedNativeBox(
          (start.x + end.x) / 2 - distance / 2,
          (start.y + end.y) / 2 - 0.006,
          distance,
          0.012,
        ),
        rotation: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
        style: {
          color: theme.colors.trace,
          strokeWidth: Math.max(1, Math.min(12, strokeWidth)),
        },
      });
    };

    if (geometry.kind === 'waterfall') {
      geometry.marks.connectors.forEach((connector, index) =>
        pushConnector(
          `connector-${index + 1}`,
          'Waterfall subtotal connector',
          'artifact_waterfall_connector',
          connector.from,
          connector.to,
        ),
      );
      geometry.marks.bars.forEach((bar, index) => {
        pushNative(`bar-${index + 1}`, {
          name: `Waterfall bar: ${bar.label}`,
          kind: 'shape',
          role: 'artifact_waterfall_bar',
          bbox: boundedNativeBox(
            mapX(bar.x),
            mapY(bar.y),
            mapWidth(bar.width),
            mapHeight(bar.height),
          ),
          rotation: 0,
          content: `${bar.label}\n${bar.value} ${bar.unit}`,
          style: {
            fill:
              bar.id === 'baseline' || bar.id === 'final'
                ? theme.colors.insight
                : bar.value >= 0
                  ? theme.colors.accentSoft
                  : '#FADBD8',
            stroke: theme.colors.border,
            strokeWidth: 1,
            color: theme.colors.ink,
            fontFamily: theme.typography.data,
            fontSize: 14,
            fontWeight: 650,
            padding: 6,
            radius: 4,
            textAlign: 'center',
            verticalAlign: 'middle',
          },
        });
      });
    } else if (geometry.kind === 'sankey') {
      geometry.marks.links.forEach((link, index) => {
        pushConnector(
          `link-${index + 1}`,
          `Sankey flow: ${link.source} to ${link.target}`,
          'artifact_sankey_link',
          link.from,
          link.to,
          link.width * 1.15,
        );
        if (link.from && link.to) {
          pushNative(`link-label-${index + 1}`, {
            name: 'Sankey flow value',
            kind: 'text',
            role: 'artifact_sankey_value',
            bbox: boundedNativeBox(
              mapX((link.from.x + link.to.x) / 2) - 0.04,
              mapY((link.from.y + link.to.y) / 2) - 0.018,
              0.08,
              0.036,
            ),
            rotation: 0,
            content: `${link.value} ${geometry.marks.unit}`,
            style: {
              fill: theme.colors.canvas,
              color: theme.colors.ink,
              fontFamily: theme.typography.data,
              fontSize: 14,
              fontWeight: 650,
              textAlign: 'center',
              verticalAlign: 'middle',
            },
          });
        }
      });
      geometry.marks.nodes.forEach((node, index) => {
        pushNative(`node-${index + 1}`, {
          name: `Sankey node: ${node.label}`,
          kind: 'shape',
          role: 'artifact_sankey_node',
          bbox: boundedNativeBox(
            mapX(node.x) - 0.018,
            mapY(node.y),
            Math.max(0.055, mapWidth(node.width) + 0.036),
            mapHeight(node.height),
          ),
          rotation: 0,
          content: node.label,
          style: {
            fill: theme.colors.insight,
            stroke: theme.colors.accent,
            strokeWidth: 1,
            color: theme.colors.insightInk,
            fontFamily: theme.typography.body,
            fontSize: 14,
            fontWeight: 650,
            padding: 5,
            radius: 6,
            textAlign: 'center',
            verticalAlign: 'middle',
          },
        });
      });
    } else if (geometry.kind === 'gantt') {
      geometry.marks.dependencies.forEach((dependency, index) =>
        pushConnector(
          `dependency-${index + 1}`,
          `Gantt dependency: ${dependency.dependencyId} to ${dependency.taskId}`,
          'artifact_gantt_dependency',
          dependency.from,
          dependency.to,
        ),
      );
      geometry.marks.tasks.forEach((task, index) => {
        pushNative(`task-${index + 1}`, {
          name: `Gantt task: ${task.label}`,
          kind: 'shape',
          role: 'artifact_gantt_task',
          bbox: boundedNativeBox(
            mapX(task.x),
            mapY(task.y),
            mapWidth(task.width),
            mapHeight(task.height),
          ),
          rotation: 0,
          content: `${task.label}\n${Math.round(task.confidence * 100)}% confidence`,
          style: {
            fill: theme.colors.accent,
            opacity: task.opacity,
            color: theme.colors.canvas,
            fontFamily: theme.typography.body,
            fontSize: 14,
            fontWeight: 650,
            padding: 6,
            radius: 5,
            verticalAlign: 'middle',
          },
        });
      });
      pushNative('domain', {
        name: 'Gantt time domain',
        kind: 'text',
        role: 'artifact_gantt_domain',
        bbox: box(stage.x, stage.y + stage.height + 0.004, stage.width, 0.03),
        rotation: 0,
        content: `${geometry.marks.domain.min}–${geometry.marks.domain.max} ${geometry.marks.domain.unit}`,
        style: {
          color: theme.colors.muted,
          fontFamily: theme.typography.data,
          fontSize: 14,
          textAlign: 'center',
        },
      });
    } else if (geometry.kind === 'risk-matrix') {
      geometry.marks.risks.forEach((risk, index) => {
        const radiusX = Math.max(0.018, mapWidth(risk.radius));
        const radiusY = Math.max(0.018, mapHeight(risk.radius));
        pushNative(`risk-${index + 1}`, {
          name: `Risk marker: ${risk.label}`,
          kind: 'shape',
          role: 'artifact_risk_marker',
          bbox: boundedNativeBox(
            mapX(risk.x) - radiusX,
            mapY(risk.y) - radiusY,
            radiusX * 2,
            radiusY * 2,
          ),
          rotation: 0,
          style: {
            fill: theme.colors.accent,
            stroke: theme.colors.insightInk,
            strokeWidth: 1,
            radius: 999,
          },
          altText: `${risk.label}; likelihood ${risk.likelihood}; impact ${risk.impact}`,
        });
        pushNative(`risk-label-${index + 1}`, {
          name: `Risk label: ${risk.label}`,
          kind: 'text',
          role: 'artifact_risk_label',
          bbox: boundedNativeBox(mapX(risk.x) - 0.06, mapY(risk.y) + radiusY + 0.004, 0.12, 0.04),
          rotation: 0,
          content: risk.label,
          style: {
            color: theme.colors.ink,
            fontFamily: theme.typography.body,
            fontSize: 14,
            fontWeight: 650,
            textAlign: 'center',
          },
        });
      });
      const axis = geometry.marks;
      const axisLabels: Array<[string, string, number, number]> = [
        ['likelihood-low', axis.likelihoodAxis.low, stage.x, stage.y + stage.height - 0.03],
        [
          'likelihood-high',
          axis.likelihoodAxis.high,
          stage.x + stage.width - 0.12,
          stage.y + stage.height - 0.03,
        ],
        ['impact-low', axis.impactAxis.low, stage.x, stage.y + stage.height - 0.065],
        ['impact-high', axis.impactAxis.high, stage.x, stage.y],
      ];
      for (const [key, label, x, y] of axisLabels) {
        pushNative(`axis-${key}`, {
          name: `Risk axis: ${label}`,
          kind: 'text',
          role: 'artifact_risk_axis',
          bbox: boundedNativeBox(x, y, 0.12, 0.035),
          rotation: 0,
          content: label,
          style: {
            color: theme.colors.muted,
            fontFamily: theme.typography.data,
            fontSize: 14,
          },
        });
      }
    } else if (geometry.kind === 'trace') {
      geometry.marks.spans.forEach((span, index) => {
        pushNative(`span-${index + 1}`, {
          name: `Trace span: ${span.spanId}`,
          kind: 'shape',
          role: 'artifact_trace_span',
          bbox: boundedNativeBox(
            mapX(span.x),
            mapY(span.y),
            mapWidth(span.width),
            mapHeight(span.height),
          ),
          rotation: 0,
          content:
            span.durationMs === null
              ? `${span.spanId}\nTiming not supplied`
              : `${span.spanId}\n${span.durationMs} ms`,
          style: {
            fill: span.parentSpanId ? theme.colors.accentSoft : theme.colors.insight,
            stroke: theme.colors.trace,
            strokeWidth: 1,
            color: theme.colors.ink,
            fontFamily: theme.typography.data,
            fontSize: 14,
            padding: 5,
            radius: 4,
            verticalAlign: 'middle',
          },
        });
      });
      pushNative('domain', {
        name: 'Trace time domain',
        kind: 'text',
        role: 'artifact_trace_domain',
        bbox: box(stage.x, stage.y + stage.height + 0.004, stage.width, 0.03),
        rotation: 0,
        content: `${geometry.marks.domain.min}–${geometry.marks.domain.max} ms`,
        style: {
          color: theme.colors.muted,
          fontFamily: theme.typography.data,
          fontSize: 14,
          textAlign: 'center',
        },
      });
    } else if (geometry.kind === 'spatial-scene') {
      geometry.marks.viewports.forEach((viewport, index) => {
        pushNative(`viewport-${index + 1}`, {
          name: `Spatial viewport: ${viewport.id}`,
          kind: 'shape',
          role: 'artifact_spatial_viewport',
          bbox: boundedNativeBox(
            mapX(viewport.x),
            mapY(viewport.y),
            mapWidth(viewport.width),
            mapHeight(viewport.height),
          ),
          rotation: 0,
          content: `${viewport.id}${viewport.selectedNodeId ? `\nSelected: ${viewport.selectedNodeId}` : ''}`,
          style: {
            fill: index === 0 ? theme.colors.accentSoft : theme.colors.insight,
            opacity: 0.25 + Math.min(0.6, index * 0.12),
            stroke: theme.colors.trace,
            strokeWidth: 2,
            color: theme.colors.ink,
            fontFamily: theme.typography.body,
            fontSize: 14,
            fontWeight: 650,
            padding: 8,
            radius: 6,
          },
        });
      });
      pushNative('legend', {
        name: 'Spatial viewport legend',
        kind: 'text',
        role: 'artifact_spatial_legend',
        bbox: box(stage.x, stage.y + stage.height + 0.004, stage.width, 0.03),
        rotation: 0,
        content: 'Nested viewport scale · editable native geometry',
        style: {
          color: theme.colors.muted,
          fontFamily: theme.typography.data,
          fontSize: 14,
          textAlign: 'center',
        },
      });
    }

    if (nativeElements.length === 0 || nativeElements.length > 16) {
      throw new Error(
        `NodeSlide authored ArtifactSpec failed [artifact_native_mark_budget]: ${geometry.kind} materialized ${nativeElements.length} elements; expected 1-16.`,
      );
    }
    const groupId = nodeslideStableId(
      'group',
      input.slideId,
      authoredArtifactBinding.artifactId,
      geometry.kind,
    );
    for (const nativeElement of nativeElements) {
      nativeElement.groupId = groupId;
      add(nativeElement);
    }
    rightColumnBottom = Math.max(rightColumnBottom ?? 0, stage.y + stage.height + 0.034);
  }

  if (planned.diagram && !hasNativeArtifactGeometry) {
    const diagram = planned.diagram;
    const diagramArtifactId =
      authoredArtifactBinding?.artifactId ?? nodeslideStableId('artifact_graph', input.slideId);
    const diagramX = 0.42;
    const diagramY = Math.max(0.43, headlineY + headlineHeight + 0.04);
    const diagramWidth = 0.51;
    const diagramHeight = Math.max(0.24, 0.87 - diagramY);
    const positions = layoutDiagramNodes(diagram, diagramX, diagramY, diagramWidth, diagramHeight);
    const positionsById = new Map(positions.map((position) => [position.id, position]));
    diagram.edges.forEach((edge, edgeIndex) => {
      const from = positionsById.get(edge.from);
      const to = positionsById.get(edge.to);
      if (!from || !to) return;
      const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
      const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
      const deltaX = toCenter.x - fromCenter.x;
      const deltaY = toCenter.y - fromCenter.y;
      const centerDistance = Math.max(0.02, Math.hypot(deltaX, deltaY));
      const unitX = deltaX / centerDistance;
      const unitY = deltaY / centerDistance;
      const fromInset = diagramNodeRayInset(from, unitX, unitY) + 0.006;
      const toInset = diagramNodeRayInset(to, unitX, unitY) + 0.006;
      const start = {
        x: fromCenter.x + unitX * fromInset,
        y: fromCenter.y + unitY * fromInset,
      };
      const end = {
        x: toCenter.x - unitX * toInset,
        y: toCenter.y - unitY * toInset,
      };
      const distance = Math.max(0.02, Math.hypot(end.x - start.x, end.y - start.y));
      add(
        element(`diagram-edge-${edgeIndex + 1}`, {
          name: edge.label ? `Diagram edge: ${edge.label}` : 'Diagram edge',
          kind: 'connector',
          role: 'diagram_edge',
          bbox: box(
            (start.x + end.x) / 2 - distance / 2,
            (start.y + end.y) / 2 - 0.012,
            distance,
            0.024,
          ),
          rotation: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
          style: { color: theme.colors.trace, strokeWidth: 2 },
          artifactBinding: {
            schemaVersion: 'nodeslide.production-artifact-binding/v1',
            artifactId: diagramArtifactId,
            role: 'graph-edge',
            graphKind: diagram.kind,
            from: edge.from,
            to: edge.to,
            ...(edge.label ? { label: edge.label } : {}),
          },
          sourceIds: evidenceSourceIds,
          ...(authoredArtifactBinding ? { authoredArtifactBinding } : {}),
          locked: false,
          exportCapabilities: [...EDITABLE_CAPABILITIES],
        }),
      );
    });
    positions.forEach((position, nodeIndex) => {
      const node = diagram.nodes[nodeIndex];
      if (!node) return;
      add(
        element(`diagram-node-${node.id}`, {
          name: `Diagram node: ${node.label}`,
          kind: 'shape',
          role: `diagram_${node.kind ?? 'step'}`,
          bbox: box(position.x, position.y, position.width, position.height),
          rotation: 0,
          content: node.label,
          style: {
            fill:
              node.kind === 'decision' || node.kind === 'milestone'
                ? theme.colors.insight
                : theme.colors.accentSoft,
            stroke: node.kind === 'decision' ? theme.colors.accent : theme.colors.border,
            strokeWidth: node.kind === 'decision' ? 2 : 1,
            color: theme.colors.ink,
            fontFamily: theme.typography.body,
            fontSize: 16,
            fontWeight: 650,
            lineHeight: 1.15,
            padding: 12,
            radius: theme.defaultRadius,
            textAlign: 'center',
            verticalAlign: 'middle',
          },
          artifactBinding: {
            schemaVersion: 'nodeslide.production-artifact-binding/v1',
            artifactId: diagramArtifactId,
            role: 'graph-node',
            graphKind: diagram.kind,
            nodeId: node.id,
            ...(node.kind ? { nodeKind: node.kind } : {}),
          },
          sourceIds: evidenceSourceIds,
          ...(authoredArtifactBinding ? { authoredArtifactBinding } : {}),
          locked: false,
          exportCapabilities: [...EDITABLE_CAPABILITIES],
        }),
      );
    });
  }

  if (planned.chart && !hasNativeArtifactGeometry) {
    const labels = planned.chart.labels.slice(0, 8);
    const values = planned.chart.values.slice(0, labels.length);
    const chartAlone = !(hasPrimaryMedia || planned.metric);
    // Chart-dominant slides let the chart claim ~55% of the canvas width;
    // other layouts keep the legacy right-column footprint.
    const chartX = isChartDominant ? 0.42 : 0.53;
    const chartWidth = isChartDominant ? 0.5 : 0.39;
    const chartBox = placeRight(0.42, chartAlone ? (isChartDominant ? 0.46 : 0.4) : 0.17);
    add(
      element('chart', {
        name: 'Evidence chart',
        kind: 'chart',
        role: 'evidence',
        bbox: box(chartX, chartBox.y, chartWidth, chartBox.height),
        rotation: 0,
        style: {
          fill: theme.colors.accentSoft,
          color: theme.colors.ink,
          radius: theme.defaultRadius,
          padding: 14,
        },
        chart: {
          chartType: 'bar',
          labels,
          series: [{ name: 'Signal', values, color: theme.colors.accent }],
          ...(planned.chart.unit ? { unit: planned.chart.unit } : {}),
          sourceId: primaryEvidenceSourceId,
        },
        sourceIds: evidenceSourceIds,
        ...(authoredArtifactBinding ? { authoredArtifactBinding } : {}),
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  }

  add(
    element('footer', {
      name: 'Deck footer',
      kind: 'text',
      role: 'footer',
      bbox: box(0.07, 0.93, 0.72, 0.035),
      rotation: 0,
      content: 'NODESLIDE  ·  SOURCE-AWARE  ·  EDITABLE',
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.data,
        fontSize: 10,
        fontWeight: 550,
        letterSpacing: 1.1,
      },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  add(
    element('page-number', {
      name: 'Page number',
      kind: 'text',
      role: 'page_number',
      bbox: box(0.88, 0.92, 0.06, 0.05),
      rotation: 0,
      content: String(input.index + 1).padStart(2, '0'),
      style: {
        color: theme.colors.accent,
        fontFamily: theme.typography.data,
        fontSize: 13,
        fontWeight: 700,
        textAlign: 'right',
      },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );

  // Geometry gate: no slide may materialize with colliding content elements.
  // A bounded pass pushes the lower element of each colliding pair down; if
  // geometry still collides afterwards the generation must fail loudly
  // instead of persisting broken layout.
  const collidable = elements.filter(
    (candidate) =>
      candidate.kind !== 'shape' &&
      candidate.kind !== 'connector' &&
      candidate.role !== 'footer' &&
      candidate.role !== 'page_number',
  );
  const resolution = resolveCollisions(
    collidable.map((candidate) => ({ id: candidate.id, bbox: candidate.bbox })),
  );
  if (!resolution.resolved) {
    const pairs = resolution.remaining
      .map((pair) => `${pair.first} × ${pair.second} (${Math.round(pair.overlapRatio * 100)}%)`)
      .join('; ');
    throw new Error(
      `NodeSlide layout: unresolved element collision on slide "${planned.title}": ${pairs}`,
    );
  }
  if (resolution.nudged.length > 0) {
    for (const candidate of elements) {
      const resolvedBox = resolution.boxes.get(candidate.id);
      if (resolvedBox) candidate.bbox = resolvedBox;
    }
  }

  return {
    slide: {
      id: input.slideId,
      deckId: input.deckId,
      title: planned.title,
      section: planned.section,
      archetype,
      notes: `Narrative role: ${planned.section}. Keep the spoken transition focused on “${planned.headline}”\n\nEvidence note: Content is based on the supplied creation brief. Illustrative examples are not independently verified; replace them with measured evidence before external publication.`,
      background: theme.colors.canvas,
      elementOrder: elements.map((candidate) => candidate.id),
      version: 1,
    },
    elements,
  };
}

function layoutDiagramNodes(
  diagram: NodeSlidePlannedDiagram,
  x: number,
  y: number,
  width: number,
  height: number,
): Array<{ id: string; x: number; y: number; width: number; height: number }> {
  const count = diagram.nodes.length;
  const columns =
    diagram.direction === 'vertical' ? (count > 4 ? 2 : 1) : Math.min(count, count > 4 ? 4 : 3);
  const rows = Math.ceil(count / columns);
  const gapX = columns > 1 ? 0.025 : 0;
  const gapY = rows > 1 ? 0.035 : 0;
  const nodeWidth = (width - gapX * (columns - 1)) / columns;
  const nodeHeight = Math.min(0.14, (height - gapY * (rows - 1)) / rows);
  const usedHeight = nodeHeight * rows + gapY * (rows - 1);
  const startY = y + Math.max(0, (height - usedHeight) / 2);
  return diagram.nodes.map((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: node.id,
      x: x + column * (nodeWidth + gapX),
      y: startY + row * (nodeHeight + gapY),
      width: nodeWidth,
      height: nodeHeight,
    };
  });
}

function diagramNodeRayInset(
  node: { width: number; height: number },
  unitX: number,
  unitY: number,
): number {
  const horizontal =
    Math.abs(unitX) > 1e-6 ? node.width / 2 / Math.abs(unitX) : Number.POSITIVE_INFINITY;
  const vertical =
    Math.abs(unitY) > 1e-6 ? node.height / 2 / Math.abs(unitY) : Number.POSITIVE_INFINITY;
  return Math.min(horizontal, vertical);
}

function coercePlannedSlide(
  value: unknown,
  fallback: NodeSlidePlannedSlide | undefined,
  index: number,
  artifactValidationOptions: ReturnType<typeof nodeSlideAuthoredArtifactValidationOptions>,
): NodeSlidePlannedSlide | null {
  if (!isRecord(value)) return fallback ?? null;
  const title = cleanField(value.title, fallback?.title ?? `Slide ${index + 1}`, 80);
  const headline = cleanField(value.headline, fallback?.headline ?? title, 180);
  const body = cleanField(value.body, fallback?.body ?? headline, 360);
  const section = cleanField(value.section, fallback?.section ?? `Story / ${index + 1}`, 60);
  const bullets = Array.isArray(value.bullets)
    ? value.bullets
        .filter((bullet): bullet is string => typeof bullet === 'string')
        .map(cleanPlannedBullet)
        .filter(Boolean)
        .slice(0, 3)
    : (fallback?.bullets ?? []);
  const authoredArtifact =
    value.artifactSpec === undefined
      ? undefined
      : compileNodeSlideAuthoredArtifact(value.artifactSpec, artifactValidationOptions);
  const metric =
    authoredArtifact?.planned.metric ??
    (typeof value.metric === 'string' ? nodeslideCleanText(value.metric, 24) : undefined);
  const metricLabel =
    authoredArtifact?.planned.metricLabel ??
    (typeof value.metricLabel === 'string'
      ? nodeslideCleanText(value.metricLabel, 100)
      : undefined);
  const explicitChart = authoredArtifact
    ? authoredArtifact.planned.chart
    : coerceChart(value.chart);
  const explicitDiagram = authoredArtifact
    ? authoredArtifact.planned.diagram
    : coerceDiagram(value['diagram']);
  const explicitFormula = authoredArtifact
    ? authoredArtifact.planned.formula
    : coerceFormula(value.formula ?? value.math);
  const explicitImage = authoredArtifact
    ? authoredArtifact.planned.image
    : coerceImage(value.image);
  const explicitVideo = authoredArtifact ? undefined : coerceVideo(value.video);
  // A valid provider slide must stand on the structured artifacts it actually
  // supplied. Borrowing a fallback artifact by slide index can make a prose-only
  // response look complete and prevents the creation critique from detecting
  // the missing visual. The deterministic route already supplies its own
  // explicit primitives, so it remains unchanged.
  // Keep one dominant visual if malformed provider output supplies several.
  // Numeric semantics win first, followed by explicit relationships, formula,
  // image, and video. The critique reports the conflict and requests a revision.
  const chart = explicitChart;
  const diagram = chart ? undefined : explicitDiagram;
  const formula = chart || diagram ? undefined : explicitFormula;
  const image = chart || diagram || formula ? undefined : explicitImage;
  const video = chart || diagram || formula || image ? undefined : explicitVideo;
  return {
    title,
    section,
    headline,
    body,
    bullets: bullets.length > 0 ? bullets : ['Context', 'Action', 'Outcome'],
    ...(metric ? { metric } : {}),
    ...(metricLabel ? { metricLabel } : {}),
    ...(chart ? { chart } : {}),
    ...(diagram ? { diagram } : {}),
    ...(formula ? { formula } : {}),
    ...(image ? { image } : {}),
    ...(video ? { video } : {}),
    ...(authoredArtifact ? { authoredArtifactCompilation: authoredArtifact.receipt } : {}),
    ...(authoredArtifact ? { authoredArtifactSpec: authoredArtifact.spec } : {}),
    ...(authoredArtifact?.geometry ? { authoredArtifactGeometry: authoredArtifact.geometry } : {}),
  };
}

function coerceDiagram(value: unknown): NodeSlidePlannedDiagram | undefined {
  if (!isRecord(value) || !Array.isArray(value['nodes']) || !Array.isArray(value['edges'])) {
    return undefined;
  }
  const rawToCleanId = new Map<string, string>();
  const usedIds = new Set<string>();
  const nodes = value['nodes'].slice(0, 7).flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const label = cleanField(candidate['label'], '', 80);
    if (!label) return [];
    const rawId = cleanField(candidate['id'], `node-${index + 1}`, 48);
    if (rawToCleanId.has(rawId)) return [];
    const baseId =
      rawId
        .normalize('NFKC')
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9_-]+/gu, '-')
        .replace(/^-+|-+$/gu, '') || `node-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    rawToCleanId.set(rawId, id);
    const kind = ['step', 'system', 'decision', 'milestone'].includes(String(candidate['kind']))
      ? (candidate['kind'] as NodeSlidePlannedDiagramNode['kind'])
      : undefined;
    return [{ id, label, ...(kind ? { kind } : {}) }];
  });
  if (nodes.length < 2) return undefined;
  const edges = value['edges'].slice(0, 10).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const from = rawToCleanId.get(cleanField(candidate['from'], '', 48));
    const to = rawToCleanId.get(cleanField(candidate['to'], '', 48));
    if (!from || !to || from === to) return [];
    const label = cleanField(candidate['label'], '', 64);
    return [{ from, to, ...(label ? { label } : {}) }];
  });
  if (edges.length === 0) return undefined;
  const kind =
    value['kind'] === 'architecture' || value['kind'] === 'timeline' ? value['kind'] : 'process';
  return {
    kind,
    direction: value['direction'] === 'vertical' ? 'vertical' : 'horizontal',
    nodes,
    edges,
  };
}

function coerceChart(value: unknown): NodeSlidePlannedChart | undefined {
  if (!isRecord(value) || !Array.isArray(value.labels) || !Array.isArray(value.values)) {
    return undefined;
  }
  const labels = value.labels
    .filter((label): label is string => typeof label === 'string')
    .map((label) => nodeslideCleanText(label, 30))
    .slice(0, 8);
  const values = value.values
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    .slice(0, labels.length);
  if (labels.length < 2 || values.length !== labels.length) return undefined;
  return {
    labels,
    values,
    ...(typeof value.unit === 'string' ? { unit: nodeslideCleanText(value.unit, 16) } : {}),
  };
}

function coerceFormula(value: unknown): NodeSlidePlannedFormula | undefined {
  if (!isRecord(value)) return undefined;
  const expression = cleanField(value.expression, '', 4_000);
  const display = cleanField(value.display, expression, 4_000);
  if (!expression || !display) return undefined;
  const syntax = value.syntax === 'latex' ? 'latex' : 'plain';
  const description =
    typeof value.description === 'string' ? nodeslideCleanText(value.description, 320) : undefined;
  const variables = Array.isArray(value.variables)
    ? value.variables.flatMap((candidate) => {
        if (!isRecord(candidate) || typeof candidate.value !== 'number') return [];
        const label = cleanField(candidate.label, '', 48);
        if (!label || !Number.isFinite(candidate.value)) return [];
        const unit = cleanField(candidate.unit, '', 24);
        return [{ label, value: candidate.value, ...(unit ? { unit } : {}) }];
      })
    : [];
  return {
    expression,
    display,
    variables: variables.slice(0, 8),
    syntax,
    ...(description ? { description } : {}),
  };
}

function coerceImage(value: unknown): NodeSlidePlannedImage | undefined {
  if (!isRecord(value)) return undefined;
  const altText = cleanField(value.altText, '', 320);
  if (!altText) return undefined;
  const url = safePlannedMediaUrl(value.url ?? value.imageUrl, 'image');
  const credit =
    typeof value.credit === 'string' ? nodeslideCleanText(value.credit, 180) : undefined;
  const caption =
    typeof value.caption === 'string' ? nodeslideCleanText(value.caption, 240) : undefined;
  return {
    altText,
    ...(url ? { imageUrl: url } : {}),
    ...(credit ? { credit } : {}),
    ...(caption ? { caption } : {}),
  };
}

function coerceVideo(value: unknown): NodeSlidePlannedVideo | undefined {
  if (!isRecord(value)) return undefined;
  const url = safePlannedMediaUrl(value.url, 'video');
  if (!url) return undefined;
  const posterUrl = safePlannedMediaUrl(value.posterUrl, 'image');
  const title = typeof value.title === 'string' ? nodeslideCleanText(value.title, 160) : undefined;
  const captionsUrl = safePlannedCaptionUrl(value['captionsUrl']);
  const captionsLanguage =
    typeof value['captionsLanguage'] === 'string'
      ? nodeslideCleanText(value['captionsLanguage'], 32)
      : undefined;
  const startAtSeconds = boundedMediaTime(value.startAtSeconds);
  const requestedEnd = boundedMediaTime(value.endAtSeconds);
  const endAtSeconds =
    requestedEnd !== undefined && requestedEnd > (startAtSeconds ?? 0) ? requestedEnd : undefined;
  return {
    url,
    ...(posterUrl ? { posterUrl } : {}),
    ...(title ? { title } : {}),
    ...(captionsUrl ? { captionsUrl } : {}),
    ...(captionsLanguage ? { captionsLanguage } : {}),
    ...(startAtSeconds !== undefined ? { startAtSeconds } : {}),
    ...(endAtSeconds !== undefined ? { endAtSeconds } : {}),
  };
}

function safePlannedCaptionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().slice(0, 4_000);
  const lower = clean.toLowerCase();
  return lower.startsWith('https://') || lower.startsWith('data:text/vtt') ? clean : undefined;
}

function safePlannedMediaUrl(value: unknown, kind: 'image' | 'video'): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().slice(0, 4_000);
  if (kind === 'image') return isNodeSlideEmbeddedRasterDataUrl(clean) ? clean : undefined;
  const lower = clean.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('data:video/')) return clean;
  return undefined;
}

function boundedMediaTime(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, 86_400)
    : undefined;
}

function linkedBriefSources(deckId: string, prompt: string, now: number): SourceRecord[] {
  const urls = nodeSlideAuthoredArtifactLinkedUrls(prompt);
  return urls.map((url, index) => {
    let hostname = 'Linked source';
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // The source still remains an explicit user-supplied URL.
    }
    return {
      id: nodeslideStableId('source', deckId, 'url', String(index + 1), url),
      deckId,
      title: `${hostname} · supplied source ${index + 1}`,
      url,
      sourceType: 'url' as const,
      retrievedAt: now,
      citation: url,
      license: 'User-supplied linked evidence; verify reuse rights before external publication.',
    };
  });
}

function cleanField(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? nodeslideCleanText(value, maxLength) || fallback : fallback;
}

function cleanPlannedBullet(value: string): string {
  return nodeslideCleanText(value, 100)
    .replace(/^(?:(?:0?\d{1,2})\s*[.):\-·]\s*|[•–—-]\s*)+/u, '')
    .trim();
}

interface NodeSlideInputRecord extends Record<string, unknown> {
  slides?: unknown;
  narrative?: unknown;
  title?: unknown;
  headline?: unknown;
  body?: unknown;
  section?: unknown;
  bullets?: unknown;
  metric?: unknown;
  metricLabel?: unknown;
  chart?: unknown;
  formula?: unknown;
  math?: unknown;
  image?: unknown;
  video?: unknown;
  expression?: unknown;
  syntax?: unknown;
  display?: unknown;
  description?: unknown;
  variables?: unknown;
  label?: unknown;
  value?: unknown;
  altText?: unknown;
  credit?: unknown;
  caption?: unknown;
  url?: unknown;
  imageUrl?: unknown;
  posterUrl?: unknown;
  captionsUrl?: unknown;
  captionsLanguage?: unknown;
  startAtSeconds?: unknown;
  endAtSeconds?: unknown;
  artifactSpec?: unknown;
  labels?: unknown;
  values?: unknown;
  unit?: unknown;
}

function isRecord(value: unknown): value is NodeSlideInputRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function box(x: number, y: number, width: number, height: number): BoundingBox {
  // Stacked positions are sums of measured heights; round to a stable grid so
  // deterministic builds hash identically across platforms.
  const snap = (value: number) => Math.round(value * 10_000) / 10_000;
  return { x: snap(x), y: snap(y), width: snap(width), height: snap(height) };
}

function isMatchingCanonicalGolden(snapshot: DeckSnapshot, canonical: DeckSnapshot): boolean {
  if (
    snapshot.deck.id !== canonical.deck.id ||
    !snapshot.deck.id.startsWith('deck_golden_') ||
    snapshot.deck.schemaVersion !== canonical.deck.schemaVersion
  ) {
    return false;
  }
  const currentSlides = new Set(snapshot.slides.map((slide) => slide.id));
  const currentElements = new Set(snapshot.elements.map((element) => element.id));
  return (
    canonical.slides.every((slide) => currentSlides.has(slide.id)) &&
    canonical.elements.every((element) => currentElements.has(element.id))
  );
}

function isUntouchedCanonicalElementIdentity(
  current: SlideElement,
  expected: SlideElement,
): boolean {
  return (
    current.version === 1 &&
    current.slideId === expected.slideId &&
    current.name === expected.name &&
    current.kind === expected.kind &&
    current.role === expected.role &&
    current.locked === expected.locked &&
    sameMembers(current.sourceIds, expected.sourceIds)
  );
}

function isCanonicalMathWithLegacyCapabilityDeclaration(
  current: SlideElement,
  expected: SlideElement,
): boolean {
  if (
    current.version !== 2 ||
    current.kind !== 'math' ||
    expected.kind !== 'math' ||
    stableJson(current.exportCapabilities) !== stableJson(EDITABLE_CAPABILITIES)
  ) {
    return false;
  }

  const {
    version: _currentVersion,
    exportCapabilities: _currentCapabilities,
    visible: currentVisible,
    ...currentRest
  } = current;
  const {
    version: _expectedVersion,
    exportCapabilities: _expectedCapabilities,
    visible: expectedVisible,
    ...expectedRest
  } = expected;
  return (
    (currentVisible ?? true) === (expectedVisible ?? true) &&
    stableJson(currentRest) === stableJson(expectedRest)
  );
}

function isLegacyDuplicatedNumberedBullet(current: SlideElement, expected: SlideElement): boolean {
  if (current.kind !== 'text' || expected.kind !== 'text') return false;
  const currentText = current.content?.trim() ?? '';
  const expectedText = expected.content?.trim() ?? '';
  if (!currentText || !expectedText || currentText === expectedText) return false;
  const duplicatedNumber = expectedText.match(/^(\d{1,2})(\s*[·.):-]\s*.+)$/u);
  if (duplicatedNumber) {
    const [, number, rest] = duplicatedNumber;
    if (currentText === `${number} ${number}${rest}`) return true;
  }
  if (expectedText.startsWith('• ') && currentText === `• ${expectedText}`) return true;
  return false;
}

function geometryValidationIssueCount(snapshot: DeckSnapshot): number {
  return validateNodeSlideSnapshot(snapshot, snapshot.deck.updatedAt).issues.filter(
    (issue) => issue.code === 'overflow' || issue.code === 'collision',
  ).length;
}

function sameBoundingBox(left: BoundingBox, right: BoundingBox): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}
