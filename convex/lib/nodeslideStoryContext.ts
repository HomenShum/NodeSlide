import type { BoundingBox, DeckBrief, SlideArchetype } from '../../shared/nodeslide';
import type { NodeSlideDataAttachment } from '../../shared/nodeslideAttachments';
import { inferNodeSlideRequestedSlideCount } from '../../shared/nodeslideSlideCount';

export type NodeSlideVisualMaterialKind =
  | 'brief'
  | 'dataset'
  | 'document'
  | 'numeric-series'
  | 'diagram'
  | 'formula'
  | 'image'
  | 'screenshot'
  | 'code'
  | 'execution-trace'
  | 'web-reference';

export type NodeSlideVisualMaterialStatus =
  | 'available'
  | 'constructible'
  | 'placeholder'
  | 'missing';

export interface NodeSlideVisualMaterial {
  id: string;
  kind: NodeSlideVisualMaterialKind;
  status: NodeSlideVisualMaterialStatus;
  title: string;
  provenance: 'brief' | 'attachment' | 'derived';
  detail: string;
  attachmentTitle?: string;
}

export interface NodeSlideProofObligation {
  id: string;
  claim: string;
  requiredMaterialKinds: NodeSlideVisualMaterialKind[];
  materialIds: string[];
  fulfillment: 'supported' | 'constructible' | 'blocked';
}

export interface NodeSlideStoryPhase {
  phase: 'orient' | 'build' | 'prove' | 'decide';
  slideCount: number;
  intent: string;
}

export interface NodeSlideStorySpec {
  narrativeJob: string;
  audienceNeed: string;
  memorableTakeaway: string;
  proofObligations: NodeSlideProofObligation[];
  pacing: NodeSlideStoryPhase[];
  sceneContinuity: {
    motif: string;
    progression: string[];
  };
  visualMetaphor: {
    kind: 'bridge' | 'journey' | 'signal' | 'threshold';
    subject: string;
    transformation: string;
  };
  revealPacing: Array<{
    beat: 'orient' | 'tension' | 'hint' | 'reveal' | 'prove' | 'resolve';
    intensity: number;
  }>;
  sceneStates: NodeSlideSceneState[];
  emotionalArc: {
    shape: 'rise-climax-release';
    intensity: number[];
  };
  compositionPlan: SlideArchetype[];
}

export type NodeSlideSceneStage =
  | 'establish'
  | 'pressure'
  | 'approach'
  | 'crossing'
  | 'proof'
  | 'release';

export interface NodeSlideSceneState {
  index: number;
  stage: NodeSlideSceneStage;
  progress: number;
  intensity: number;
  framing: 'wide' | 'split' | 'focused' | 'close';
  subjectState: string;
}

export interface NodeSlideStorySceneMark {
  key: string;
  role: string;
  bbox: BoundingBox;
  rotation: number;
  tone: 'accent' | 'accent-soft' | 'insight';
  opacity: number;
  radius: number;
  altText: string;
}

export interface NodeSlideVisualMaterialInventory {
  materials: NodeSlideVisualMaterial[];
  availableKinds: NodeSlideVisualMaterialKind[];
  constructibleKinds: NodeSlideVisualMaterialKind[];
  blockedKinds: NodeSlideVisualMaterialKind[];
}

export interface NodeSlideStoryContext {
  storySpec: NodeSlideStorySpec;
  materialInventory: NodeSlideVisualMaterialInventory;
}

const REQUEST_PATTERNS: ReadonlyArray<[NodeSlideVisualMaterialKind, RegExp]> = [
  ['numeric-series', /\bcharts?\b|\bgraphs?\b|\bplots?\b/u],
  ['diagram', /\bdiagrams?\b|\barchitectures?\b|\bprocess(?:es)?\b|\btimelines?\b|\bflows?\b/u],
  ['formula', /\bformulas?\b|\bequations?\b|\bcalculations?\b/u],
  ['screenshot', /\bscreenshots?\b|\bscreen captures?\b/u],
  ['image', /\bimages?\b|\bphotos?\b|\bphotographs?\b/u],
  ['code', /\bcode samples?\b|\bsnippets?\b|\bsource code\b/u],
  ['execution-trace', /\bexecution traces?\b|\bruntime traces?\b|\blogs?\b/u],
];

function clean(value: string, maxLength: number): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}

function lowercaseLead(value: string): string {
  return value ? `${value[0]?.toLocaleLowerCase() ?? ''}${value.slice(1)}` : value;
}

const STORY_BEATS = ['orient', 'tension', 'hint', 'reveal', 'prove', 'resolve'] as const;
const COMPOSITION_RHYTHM: SlideArchetype[] = [
  'statement',
  'comparison',
  'diagram-dominant',
  'stat-dominant',
  'chart-dominant',
  'media-dominant',
  'split',
];

function cinematicDirection(
  title: string,
  brief: DeckBrief,
  slideCount: number,
): Pick<
  NodeSlideStorySpec,
  | 'sceneContinuity'
  | 'visualMetaphor'
  | 'revealPacing'
  | 'sceneStates'
  | 'emotionalArc'
  | 'compositionPlan'
> {
  const text = `${title} ${brief.prompt} ${brief.purpose}`.toLowerCase();
  const metaphor: NodeSlideStorySpec['visualMetaphor'] = /risk|security|trust|exposure/u.test(text)
    ? {
        kind: 'threshold',
        subject: 'a guarded threshold',
        transformation: 'move from exposed uncertainty to controlled passage',
      }
    : /data|signal|metric|evidence|research/u.test(text)
      ? {
          kind: 'signal',
          subject: 'a signal emerging from noise',
          transformation: 'separate weak noise from decision-grade evidence',
        }
      : /platform|system|architecture|workflow|bridge/u.test(text)
        ? {
            kind: 'bridge',
            subject: 'a bridge assembled span by span',
            transformation: 'connect isolated work into a dependable path',
          }
        : {
            kind: 'journey',
            subject: 'a route from present constraint to chosen future',
            transformation: 'turn uncertainty into an owned next move',
          };
  const revealPacing = Array.from({ length: slideCount }, (_, index) => {
    const progress = slideCount === 1 ? 1 : index / (slideCount - 1);
    const beatIndex = Math.min(STORY_BEATS.length - 1, Math.floor(progress * STORY_BEATS.length));
    const climaxIndex = Math.max(1, slideCount - 2);
    const intensity =
      index <= climaxIndex
        ? Math.round(24 + (index / climaxIndex) * 76)
        : Math.max(58, 100 - (index - climaxIndex) * 24);
    return { beat: STORY_BEATS[beatIndex] ?? 'resolve', intensity };
  });
  const motifNoun =
    metaphor.kind === 'threshold'
      ? 'threshold line'
      : metaphor.kind === 'signal'
        ? 'signal pulse'
        : metaphor.kind === 'bridge'
          ? 'connecting span'
          : 'route marker';
  const sceneStates = revealPacing.map(({ beat, intensity }, index): NodeSlideSceneState => {
    const stage: NodeSlideSceneStage =
      beat === 'orient'
        ? 'establish'
        : beat === 'tension'
          ? 'pressure'
          : beat === 'hint'
            ? 'approach'
            : beat === 'reveal'
              ? 'crossing'
              : beat === 'prove'
                ? 'proof'
                : 'release';
    const framing: NodeSlideSceneState['framing'] =
      stage === 'establish' || stage === 'release'
        ? 'wide'
        : stage === 'pressure'
          ? 'split'
          : stage === 'approach' || stage === 'crossing'
            ? 'focused'
            : 'close';
    const stateByKind: Record<NodeSlideStorySpec['visualMetaphor']['kind'], string[]> = {
      threshold: [
        'the boundary is distant',
        'exposure presses against the boundary',
        'the decision approaches the gate',
        'the subject crosses the gate',
        'the controlled passage is inspectable',
        'the release state is explicit',
      ],
      signal: [
        'noise fills the field',
        'a weak pulse separates from noise',
        'the trace begins to converge',
        'one coherent signal is revealed',
        'the signal is calibrated against evidence',
        'the decision-grade signal remains visible',
      ],
      bridge: [
        'the two sides remain disconnected',
        'the gap becomes the central tension',
        'the first span reaches across the gap',
        'the path connects end to end',
        'the joined path carries proof',
        'the dependable crossing is owned',
      ],
      journey: [
        'the destination is visible but distant',
        'the route meets its constraint',
        'the next viable turn appears',
        'the route clears the decisive turn',
        'the chosen path is proven',
        'the next move and owner are explicit',
      ],
    };
    const stageIndex = [
      'establish',
      'pressure',
      'approach',
      'crossing',
      'proof',
      'release',
    ].indexOf(stage);
    return {
      index,
      stage,
      progress: Math.round(((index + 1) / Math.max(1, slideCount)) * 1_000) / 1_000,
      intensity,
      framing,
      subjectState: stateByKind[metaphor.kind][stageIndex] ?? metaphor.transformation,
    };
  });
  return {
    sceneContinuity: {
      motif: motifNoun,
      progression: revealPacing.map(({ beat }, index) => `${motifNoun} ${index + 1}: ${beat}`),
    },
    visualMetaphor: metaphor,
    revealPacing,
    sceneStates,
    emotionalArc: {
      shape: 'rise-climax-release',
      intensity: revealPacing.map(({ intensity }) => intensity),
    },
    compositionPlan: Array.from(
      { length: slideCount },
      (_, index) => COMPOSITION_RHYTHM[index % COMPOSITION_RHYTHM.length] ?? 'split',
    ),
  };
}

function sceneBox(x: number, y: number, width: number, height: number): BoundingBox {
  const snap = (value: number) => Math.round(value * 10_000) / 10_000;
  return { x: snap(x), y: snap(y), width: snap(width), height: snap(height) };
}

/**
 * Compiles the typed story state into motif-specific, editable scene marks.
 * Both the composition-grammar and legacy materializers consume this one seam,
 * so no route can silently collapse back to the former progress rail.
 */
export function buildNodeSlideStorySceneMarks(
  storySpec: NodeSlideStorySpec | undefined,
  index: number,
): NodeSlideStorySceneMark[] {
  const scene = storySpec?.sceneStates[index];
  if (!storySpec || !scene) return [];
  const { progress, intensity } = scene;
  const opacity = Math.max(0.34, intensity / 100);
  const altText = `${storySpec.visualMetaphor.subject}: ${scene.subjectState}; ${scene.stage} stage, ${Math.round(progress * 100)} percent through the story`;
  const mark = (
    key: string,
    role: string,
    bbox: BoundingBox,
    tone: NodeSlideStorySceneMark['tone'],
    markOpacity = opacity,
    radius = 999,
    rotation = 0,
  ): NodeSlideStorySceneMark => ({
    key,
    role,
    bbox,
    rotation,
    tone,
    opacity: Math.round(markOpacity * 1_000) / 1_000,
    radius,
    altText,
  });

  if (storySpec.visualMetaphor.kind === 'threshold') {
    const aperture = 0.035 + 0.105 * progress;
    const center = 0.805;
    const leftX = center - aperture / 2 - 0.012;
    const rightX = center + aperture / 2;
    return [
      mark(
        'scene-threshold-left',
        'story_scene_threshold_gate_left',
        sceneBox(leftX, 0.052, 0.012, 0.1),
        'insight',
        opacity,
        2,
      ),
      mark(
        'scene-threshold-right',
        'story_scene_threshold_gate_right',
        sceneBox(rightX, 0.052, 0.012, 0.1),
        'insight',
        opacity,
        2,
      ),
      mark(
        'scene-threshold-path',
        'story_scene_threshold_path',
        sceneBox(leftX + 0.012, 0.124, aperture, 0.009),
        'accent-soft',
        0.42 + 0.35 * progress,
        999,
      ),
      mark(
        'scene-threshold-subject',
        'story_scene_threshold_subject',
        sceneBox(0.684 + 0.19 * progress, 0.112, 0.022, 0.022),
        'accent',
        opacity,
        999,
      ),
    ];
  }

  if (storySpec.visualMetaphor.kind === 'signal') {
    const noiseOpacity = Math.max(0.12, 0.68 - progress * 0.5);
    const coreSize = 0.032 + 0.02 * progress;
    return [
      mark(
        'scene-signal-noise-1',
        'story_scene_signal_noise',
        sceneBox(0.69, 0.066, 0.015, 0.015),
        'accent-soft',
        noiseOpacity,
      ),
      mark(
        'scene-signal-noise-2',
        'story_scene_signal_noise',
        sceneBox(0.735, 0.112, 0.011, 0.011),
        'accent-soft',
        noiseOpacity * 0.82,
      ),
      mark(
        'scene-signal-noise-3',
        'story_scene_signal_noise',
        sceneBox(0.77, 0.071, 0.009, 0.009),
        'accent-soft',
        noiseOpacity * 0.64,
      ),
      mark(
        'scene-signal-wave-outer',
        'story_scene_signal_wave',
        sceneBox(0.835 - coreSize, 0.102 - coreSize, coreSize * 2.5, coreSize * 2.5),
        'accent-soft',
        0.2 + progress * 0.28,
      ),
      mark(
        'scene-signal-wave-inner',
        'story_scene_signal_wave',
        sceneBox(0.842 - coreSize / 2, 0.109 - coreSize / 2, coreSize * 1.55, coreSize * 1.55),
        'accent-soft',
        0.28 + progress * 0.34,
      ),
      mark(
        'scene-signal-core',
        'story_scene_signal_core',
        sceneBox(0.846, 0.113, coreSize, coreSize),
        'accent',
        opacity,
      ),
    ];
  }

  if (storySpec.visualMetaphor.kind === 'bridge') {
    const reached = 0.17 * progress;
    return [
      mark(
        'scene-bridge-left-anchor',
        'story_scene_bridge_anchor',
        sceneBox(0.68, 0.066, 0.012, 0.085),
        'insight',
        opacity,
        2,
      ),
      mark(
        'scene-bridge-right-anchor',
        'story_scene_bridge_anchor',
        sceneBox(0.91, 0.066, 0.012, 0.085),
        'insight',
        opacity,
        2,
      ),
      mark(
        'scene-bridge-left-span',
        'story_scene_bridge_span',
        sceneBox(0.692, 0.099, reached, 0.012),
        'accent',
        opacity,
        3,
      ),
      mark(
        'scene-bridge-right-span',
        'story_scene_bridge_span',
        sceneBox(0.91 - reached, 0.099, reached, 0.012),
        'accent',
        opacity,
        3,
      ),
      mark(
        'scene-bridge-deck',
        'story_scene_bridge_deck',
        sceneBox(0.692, 0.127, 0.218, 0.008),
        'accent-soft',
        0.2 + 0.55 * progress,
        999,
      ),
    ];
  }

  const routeReach = 0.06 + 0.17 * progress;
  return [
    mark(
      'scene-journey-route-1',
      'story_scene_journey_route',
      sceneBox(0.68, 0.13, routeReach, 0.009),
      'accent',
      opacity,
      999,
      -12,
    ),
    mark(
      'scene-journey-route-2',
      'story_scene_journey_route',
      sceneBox(0.73, 0.092, routeReach * 0.42, 0.009),
      'accent',
      opacity,
      999,
      10,
    ),
    mark(
      'scene-journey-route-3',
      'story_scene_journey_route',
      sceneBox(0.79, 0.104, routeReach * 0.4, 0.009),
      'accent',
      opacity,
      999,
      -8,
    ),
    mark(
      'scene-journey-waypoint-1',
      'story_scene_journey_waypoint',
      sceneBox(0.684, 0.122, 0.022, 0.022),
      'insight',
      0.55,
      999,
    ),
    mark(
      'scene-journey-waypoint-2',
      'story_scene_journey_waypoint',
      sceneBox(0.78, 0.083, 0.02, 0.02),
      'accent-soft',
      0.3 + 0.45 * progress,
      999,
    ),
    mark(
      'scene-journey-waypoint-3',
      'story_scene_journey_waypoint',
      sceneBox(0.895, 0.092, 0.026, 0.026),
      'accent',
      opacity,
      999,
    ),
  ];
}

function requestedSlideCount(title: string, brief: DeckBrief): number {
  return inferNodeSlideRequestedSlideCount(title, brief.prompt) ?? 7;
}

function pacingFor(slideCount: number): NodeSlideStoryPhase[] {
  const buildCount = Math.max(1, Math.min(4, Math.floor(slideCount / 3)));
  return [
    {
      phase: 'orient',
      slideCount: 1,
      intent: 'Establish the audience tension and central promise.',
    },
    {
      phase: 'build',
      slideCount: buildCount,
      intent: 'Develop the causal argument with distinct visual jobs.',
    },
    {
      phase: 'prove',
      slideCount: slideCount - buildCount - 2,
      intent: 'Resolve proof obligations with inspectable artifacts.',
    },
    {
      phase: 'decide',
      slideCount: 1,
      intent: 'Close with a decision, owner, and next checkpoint.',
    },
  ];
}

function requestedKinds(requestText: string): NodeSlideVisualMaterialKind[] {
  return REQUEST_PATTERNS.filter(([, pattern]) => hasUnnegatedRequest(requestText, pattern)).map(
    ([kind]) => kind,
  );
}

function hasUnnegatedRequest(requestText: string, pattern: RegExp): boolean {
  const matcher = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  for (const match of requestText.matchAll(matcher)) {
    const index = match.index ?? 0;
    const prefix = requestText.slice(Math.max(0, index - 72), index);
    const negated =
      /(?:\bno\b(?:[\s-]+\w+){0,3}|\bwithout\b(?:[\s-]+\w+){0,4}|\b(?:do\s+not|never|avoid|forbid)\b(?:[\s-]+\w+){0,4})[\s:,-]*$/iu.test(
        prefix,
      );
    if (!negated) return true;
  }
  return false;
}

function attachmentKind(attachment: NodeSlideDataAttachment): NodeSlideVisualMaterialKind {
  if (attachment.format === 'csv' || attachment.format === 'json') return 'dataset';
  if (/\.(?:log|trace)(?:\.txt)?$/iu.test(attachment.title)) return 'execution-trace';
  if (/\.(?:js|jsx|ts|tsx|py|rb|go|rs|java|cs|css|html|sql)(?:\.txt)?$/iu.test(attachment.title)) {
    return 'code';
  }
  return 'document';
}

function fulfillmentFor(
  requiredKind: NodeSlideVisualMaterialKind,
  materials: readonly NodeSlideVisualMaterial[],
): Pick<NodeSlideProofObligation, 'materialIds' | 'fulfillment'> {
  const direct = materials.filter((material) => material.kind === requiredKind);
  const chartInputs =
    requiredKind === 'numeric-series'
      ? materials.filter(
          (material) => material.kind === 'dataset' || material.kind === 'numeric-series',
        )
      : [];
  const candidates = direct.length > 0 ? direct : chartInputs;
  const supported = candidates.filter((material) => material.status === 'available');
  if (supported.length > 0) {
    return { materialIds: supported.map((material) => material.id), fulfillment: 'supported' };
  }
  const constructible = candidates.filter((material) => material.status === 'constructible');
  if (constructible.length > 0) {
    return {
      materialIds: constructible.map((material) => material.id),
      fulfillment: 'constructible',
    };
  }
  return { materialIds: candidates.map((material) => material.id), fulfillment: 'blocked' };
}

/**
 * Build the authoritative pre-composition contract. This is deliberately
 * deterministic: a provider can consume the contract but cannot promote a
 * placeholder or missing artifact into captured evidence.
 */
export function buildNodeSlideStoryContext(input: {
  title: string;
  brief: DeckBrief;
  attachments?: readonly NodeSlideDataAttachment[];
}): NodeSlideStoryContext {
  const attachments = input.attachments ?? [];
  const requestText =
    `${input.title} ${input.brief.prompt} ${input.brief.purpose} ${input.brief.successCriteria.join(' ')}`.toLowerCase();
  const kinds = requestedKinds(requestText);
  const materials: NodeSlideVisualMaterial[] = [
    {
      id: 'material-brief',
      kind: 'brief',
      status: 'available',
      title: 'Creation brief',
      provenance: 'brief',
      detail: 'User-supplied narrative intent; usable as context, not independent external proof.',
    },
    ...attachments.map((attachment, index) => ({
      id: `material-attachment-${index + 1}`,
      kind: attachmentKind(attachment),
      status: 'available' as const,
      title: clean(attachment.title, 120) || `Attachment ${index + 1}`,
      provenance: 'attachment' as const,
      detail:
        attachment.format === 'csv' || attachment.format === 'json'
          ? 'User-supplied structured data available for editable charts and calculations.'
          : 'User-supplied text evidence available for citation and synthesis.',
      attachmentTitle: attachment.title,
    })),
  ];

  const urlCount = (input.brief.prompt.match(/https?:\/\/[^\s)\]}>,]+/giu) ?? []).length;
  if (urlCount > 0) {
    materials.push({
      id: 'material-web-references',
      kind: 'web-reference',
      status: 'available',
      title: `${urlCount} referenced web source${urlCount === 1 ? '' : 's'}`,
      provenance: 'brief',
      detail: 'URLs were supplied in the brief; they are references, not screenshot captures.',
    });
  }

  for (const kind of kinds) {
    if (kind === 'numeric-series') {
      const hasDataset = materials.some((material) => material.kind === 'dataset');
      const numericValues = requestText.match(/\b\d+(?:\.\d+)?\b/gu) ?? [];
      materials.push({
        id: 'material-numeric-series',
        kind,
        status: hasDataset || numericValues.length >= 2 ? 'constructible' : 'missing',
        title: 'Chart-ready numeric series',
        provenance: 'derived',
        detail:
          hasDataset || numericValues.length >= 2
            ? 'An editable chart may be constructed from supplied values; chart semantics still require validation.'
            : 'A chart was requested but no structured dataset or numeric series was supplied.',
      });
      continue;
    }
    if (kind === 'diagram' || kind === 'formula') {
      materials.push({
        id: `material-${kind}`,
        kind,
        status: 'constructible',
        title: kind === 'diagram' ? 'Editable relationship diagram' : 'Editable formula',
        provenance: 'derived',
        detail:
          kind === 'diagram'
            ? 'NodeSlide can construct typed nodes and connectors from relationships in the story.'
            : 'NodeSlide can construct a structured formula; unsupported inputs must remain labeled assumptions.',
      });
      continue;
    }
    if (materials.some((material) => material.kind === kind && material.status === 'available')) {
      continue;
    }
    materials.push({
      id: `material-${kind}`,
      kind,
      status: kind === 'image' || kind === 'screenshot' ? 'placeholder' : 'missing',
      title: `${kind === 'execution-trace' ? 'Execution trace' : clean(kind, 40)} evidence`,
      provenance: 'derived',
      detail:
        kind === 'image' || kind === 'screenshot'
          ? `No captured ${kind} was supplied; composition may reserve an explicitly labeled replacement slot only.`
          : `The requested ${kind} artifact was not supplied and must not be claimed as evidence.`,
    });
  }

  const proofObligations: NodeSlideProofObligation[] = kinds.map((kind, index) => {
    const resolution = fulfillmentFor(kind, materials);
    return {
      id: `proof-${index + 1}`,
      claim: `Show the requested ${kind.replace('-', ' ')} as an inspectable artifact.`,
      requiredMaterialKinds: [kind],
      ...resolution,
    };
  });
  for (const [index, criterion] of input.brief.successCriteria.entries()) {
    const claim = clean(criterion, 180);
    if (!claim) continue;
    proofObligations.push({
      id: `success-${index + 1}`,
      claim,
      requiredMaterialKinds: ['brief'],
      materialIds: ['material-brief'],
      fulfillment: 'supported',
    });
  }

  const materialKinds = (statuses: readonly NodeSlideVisualMaterialStatus[]) =>
    Array.from(
      new Set(
        materials
          .filter((material) => statuses.includes(material.status))
          .map((material) => material.kind),
      ),
    );

  const pacing = pacingFor(requestedSlideCount(input.title, input.brief));
  const slideCount = pacing.reduce((sum, phase) => sum + phase.slideCount, 0);
  return {
    storySpec: {
      narrativeJob:
        clean(input.brief.purpose, 220) || clean(input.brief.prompt, 220) || clean(input.title, 80),
      audienceNeed: clean(
        `Help ${input.brief.audience || 'the audience'} ${lowercaseLead(input.brief.purpose || input.brief.prompt)}.`,
        240,
      ),
      memorableTakeaway:
        clean(input.brief.purpose, 220) || clean(input.brief.prompt, 220) || clean(input.title, 80),
      proofObligations,
      pacing,
      ...cinematicDirection(input.title, input.brief, slideCount),
    },
    materialInventory: {
      materials,
      availableKinds: materialKinds(['available']),
      constructibleKinds: materialKinds(['constructible']),
      blockedKinds: materialKinds(['placeholder', 'missing']),
    },
  };
}
