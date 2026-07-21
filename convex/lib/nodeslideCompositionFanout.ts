import type {
  BoundingBox,
  DeckSnapshot,
  PatchOperation,
  SlideElement,
} from '../../shared/nodeslide';
import type { NodeSlideDesignPlan } from './nodeslideDesignPlan';
import { type NodeSlidePatchInput, clocksForNodeSlideOperations } from './nodeslidePatches';
import type { NodeSlideRepairObservation } from './nodeslideRenderRepairLoop';

export type NodeSlideCompositionVariant = 'canonical' | 'mirrored' | 'visual-focus';

export interface NodeSlideCompositionCandidateSummary {
  id: string;
  slideIndex: number;
  variant: NodeSlideCompositionVariant;
  referenceId: string;
  score: number;
  overlapCount: number;
  outOfBoundsCount: number;
  dominantArea: number;
  selected: boolean;
}

export interface NodeSlideCompositionFanoutResult {
  selectedElements: SlideElement[];
  candidates: NodeSlideCompositionCandidateSummary[];
  renderCandidates: Array<{
    id: string;
    variant: NodeSlideCompositionVariant;
    elements: SlideElement[];
  }>;
  selectedCandidateId: string;
}

interface Candidate {
  variant: NodeSlideCompositionVariant;
  elements: SlideElement[];
  summary: NodeSlideCompositionCandidateSummary;
}

function cloneElements(elements: readonly SlideElement[]): SlideElement[] {
  return elements.map((element) => structuredClone(element));
}

function isPrimaryVisual(element: SlideElement): boolean {
  return (
    element.kind === 'chart' ||
    element.kind === 'image' ||
    element.kind === 'video' ||
    element.kind === 'math' ||
    element.role === 'metric' ||
    element.role?.startsWith('diagram_') === true
  );
}

function mirror(elements: readonly SlideElement[]): SlideElement[] {
  return cloneElements(elements).map((element) => ({
    ...element,
    bbox: { ...element.bbox, x: Number((1 - element.bbox.x - element.bbox.width).toFixed(6)) },
  }));
}

function focusPrimaryVisual(elements: readonly SlideElement[]): SlideElement[] {
  return cloneElements(elements).map((element) => {
    if (element.role === 'decoration') {
      return {
        ...element,
        bbox: { x: 0.07, y: 0.055, width: 0.86, height: 0.008 },
      };
    }
    if (element.role === 'section') {
      return {
        ...element,
        bbox: { ...element.bbox, x: 0.14, y: 0.075, width: 0.72 },
        style: { ...element.style, textAlign: 'center' },
      };
    }
    if (element.role === 'headline') {
      return {
        ...element,
        bbox: { ...element.bbox, x: 0.14, y: 0.15, width: 0.72, height: 0.17 },
        style: { ...element.style, textAlign: 'center' },
      };
    }
    if (element.role === 'footer') {
      return {
        ...element,
        bbox: { ...element.bbox, x: 0.22, width: 0.56 },
        style: { ...element.style, textAlign: 'center' },
      };
    }
    if (!isPrimaryVisual(element)) return element;
    const scale = element.kind === 'connector' ? 1 : 1.08;
    const width = Math.min(0.92, element.bbox.width * scale);
    const height = Math.min(0.82, element.bbox.height * scale);
    const centerX = element.bbox.x + element.bbox.width / 2;
    const centerY = element.bbox.y + element.bbox.height / 2;
    return {
      ...element,
      bbox: {
        x: Math.max(0.02, Math.min(0.98 - width, centerX - width / 2)),
        y: Math.max(0.03, Math.min(0.97 - height, centerY - height / 2)),
        width,
        height,
      },
    };
  });
}

function intersectionArea(left: BoundingBox, right: BoundingBox): number {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function candidateSummary(input: {
  elements: readonly SlideElement[];
  plan: NodeSlideDesignPlan;
  variant: NodeSlideCompositionVariant;
  referenceId: string;
}): NodeSlideCompositionCandidateSummary {
  const visible = input.elements.filter(
    (element) => element.kind !== 'connector' && element.role !== 'background',
  );
  let overlapCount = 0;
  for (let leftIndex = 0; leftIndex < visible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < visible.length; rightIndex += 1) {
      const left = visible[leftIndex];
      const right = visible[rightIndex];
      if (!left || !right) continue;
      const area = intersectionArea(left.bbox, right.bbox);
      const smallerArea = Math.min(
        left.bbox.width * left.bbox.height,
        right.bbox.width * right.bbox.height,
      );
      if (smallerArea > 0 && area / smallerArea > 0.08) overlapCount += 1;
    }
  }
  const outOfBoundsCount = input.elements.filter(
    (element) =>
      element.bbox.x < 0 ||
      element.bbox.y < 0 ||
      element.bbox.x + element.bbox.width > 1 ||
      element.bbox.y + element.bbox.height > 1,
  ).length;
  const dominantArea = input.elements
    .filter(isPrimaryVisual)
    .reduce((sum, element) => sum + element.bbox.width * element.bbox.height, 0);
  // Media geometry already alternates left/right in the archetype builder.
  // Prefer its canonical candidate so fan-out does not erase that deck-level
  // rhythm by independently mirroring or centering adjacent media slides.
  const preferredVariant: NodeSlideCompositionVariant =
    input.plan.semanticArchetype === 'media-dominant'
      ? 'canonical'
      : input.plan.slideIndex % 3 === 0
        ? 'canonical'
        : input.plan.slideIndex % 3 === 1
          ? 'visual-focus'
          : 'mirrored';
  const variantBonus =
    input.variant === preferredVariant
      ? 18
      : input.plan.dominantVisualCenter !== 'headline' && input.variant === 'visual-focus'
        ? 8
        : input.variant === 'mirrored'
          ? 2
          : 4;
  return {
    id: `composition/${input.plan.slideIndex + 1}/${input.variant}`,
    slideIndex: input.plan.slideIndex,
    variant: input.variant,
    referenceId: input.referenceId,
    score: Number(
      (
        100 +
        variantBonus +
        Math.min(12, dominantArea * 20) -
        overlapCount * 12 -
        outOfBoundsCount * 50
      ).toFixed(3),
    ),
    overlapCount,
    outOfBoundsCount,
    dominantArea: Number(dominantArea.toFixed(6)),
    selected: false,
  };
}

/** Generate three materially different geometry candidates and choose fail-closed. */
export function fanOutNodeSlideComposition(input: {
  elements: readonly SlideElement[];
  plan: NodeSlideDesignPlan;
}): NodeSlideCompositionFanoutResult {
  const variants: Array<[NodeSlideCompositionVariant, SlideElement[]]> = [
    ['canonical', cloneElements(input.elements)],
    ['mirrored', mirror(input.elements)],
    ['visual-focus', focusPrimaryVisual(input.elements)],
  ];
  const candidates: Candidate[] = variants.map(([variant, elements], index) => ({
    variant,
    elements,
    summary: candidateSummary({
      elements,
      plan: input.plan,
      variant,
      referenceId: input.plan.referenceIds[index] ?? input.plan.referenceIds[0] ?? 'unbound',
    }),
  }));
  const cleanCandidates = candidates.filter(
    (candidate) => candidate.summary.outOfBoundsCount === 0 && candidate.summary.overlapCount === 0,
  );
  const selected = [...(cleanCandidates.length > 0 ? cleanCandidates : candidates)].sort(
    (left, right) => right.summary.score - left.summary.score,
  )[0];
  if (!selected) throw new Error('Composition fan-out produced no candidates.');
  return {
    selectedElements: cloneElements(selected.elements),
    selectedCandidateId: selected.summary.id,
    renderCandidates: candidates.map((candidate) => ({
      id: candidate.summary.id,
      variant: candidate.variant,
      elements: cloneElements(candidate.elements),
    })),
    candidates: candidates.map((candidate) => ({
      ...candidate.summary,
      selected: candidate.summary.id === selected.summary.id,
    })),
  };
}

/** Pixel adapters can feed these deterministic geometry observations into the bounded repair loop. */
export function observeNodeSlideCompositionBounds(
  snapshot: Readonly<DeckSnapshot>,
  slideId: string,
): NodeSlideRepairObservation[] {
  return snapshot.elements
    .filter(
      (element) =>
        element.slideId === slideId &&
        (element.bbox.x < 0 ||
          element.bbox.y < 0 ||
          element.bbox.x + element.bbox.width > 1 ||
          element.bbox.y + element.bbox.height > 1),
    )
    .map((element) => ({
      code: 'composition_out_of_bounds',
      severity: 'error' as const,
      message: `${element.name} exceeds the slide canvas.`,
      slideId,
      elementId: element.id,
    }));
}

/** Emit a concrete, clock-bound repair proposal; persistence remains separately authorized. */
export function proposeNodeSlideCompositionBoundsRepair(
  snapshot: DeckSnapshot,
  slideId: string,
): NodeSlidePatchInput {
  const target = snapshot.elements.find(
    (element) =>
      element.slideId === slideId &&
      !element.locked &&
      (element.bbox.x < 0 ||
        element.bbox.y < 0 ||
        element.bbox.x + element.bbox.width > 1 ||
        element.bbox.y + element.bbox.height > 1),
  );
  const operations: PatchOperation[] = target
    ? [
        {
          op: 'move',
          slideId,
          elementId: target.id,
          x: Math.max(0, Math.min(1 - target.bbox.width, target.bbox.x)),
          y: Math.max(0, Math.min(1 - target.bbox.height, target.bbox.y)),
        },
      ]
    : [];
  return {
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    ...clocksForNodeSlideOperations(snapshot, operations),
    scope: {
      kind: 'slide',
      deckId: snapshot.deck.id,
      slideIds: [slideId],
      operationMode: 'unrestricted',
    },
    operations,
  };
}
