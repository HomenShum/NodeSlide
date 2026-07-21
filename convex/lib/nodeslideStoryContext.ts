import type { DeckBrief } from '../../shared/nodeslide';
import type { NodeSlideDataAttachment } from '../../shared/nodeslideAttachments';

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

function requestedSlideCount(title: string, brief: DeckBrief): number {
  const match = `${title} ${brief.prompt}`
    .toLowerCase()
    .match(/\b(six|seven|eight|6|7|8)[-\s]slide/u);
  if (!match) return 7;
  return { six: 6, seven: 7, eight: 8, '6': 6, '7': 7, '8': 8 }[match[1] ?? ''] ?? 7;
}

function pacingFor(slideCount: number): NodeSlideStoryPhase[] {
  const buildCount = slideCount === 8 ? 3 : 2;
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
  return REQUEST_PATTERNS.filter(([, pattern]) => pattern.test(requestText)).map(([kind]) => kind);
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
      pacing: pacingFor(requestedSlideCount(input.title, input.brief)),
    },
    materialInventory: {
      materials,
      availableKinds: materialKinds(['available']),
      constructibleKinds: materialKinds(['constructible']),
      blockedKinds: materialKinds(['placeholder', 'missing']),
    },
  };
}
