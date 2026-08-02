import type {
  BoundingBox,
  DeckSnapshot,
  PatchOperation,
  SlideElement,
} from '../../shared/nodeslide';
import { estimateTextHeight } from '../../shared/nodeslideLayoutMetrics';
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

function hasOrderSensitiveHorizontalSequence(elements: readonly SlideElement[]): boolean {
  if (elements.some((element) => element.role?.startsWith('diagram_') === true)) {
    return true;
  }
  const bullets = elements.filter((element) => element.role === 'bullet');
  return (
    bullets.length >= 2 &&
    Math.max(...bullets.map((element) => element.bbox.y)) -
      Math.min(...bullets.map((element) => element.bbox.y)) <
      0.04
  );
}

function mirror(elements: readonly SlideElement[]): SlideElement[] {
  return cloneElements(elements).map((element) => ({
    ...element,
    bbox: { ...element.bbox, x: Number((1 - element.bbox.x - element.bbox.width).toFixed(6)) },
    rotation:
      element.kind === 'connector'
        ? Number((((180 - element.rotation) % 360) + 360).toFixed(6)) % 360
        : element.rotation,
  }));
}

function focusPrimaryVisual(elements: readonly SlideElement[], slideIndex: number): SlideElement[] {
  const primaryVisuals = elements.filter(isPrimaryVisual);
  const hasPrimaryVisual = primaryVisuals.length > 0;
  const primaryVisualCenterX =
    primaryVisuals.reduce((sum, element) => sum + element.bbox.x + element.bbox.width / 2, 0) /
    Math.max(1, primaryVisuals.length);
  const primaryVisualOnLeft = primaryVisualCenterX < 0.5;
  const evidenceCardIds = new Map(
    elements
      .filter((element) => element.role === 'evidence_card')
      .sort((left, right) => left.bbox.x - right.bbox.x)
      .map((element, index) => [element.id, index] as const),
  );
  const textOnlyBulletIds = new Map(
    elements
      .filter((element) => element.role === 'bullet')
      .map((element, index) => [element.id, index] as const),
  );
  const evidenceBulletIds = new Map(
    elements
      .filter((element) => element.role === 'bullet' && evidenceCardIds.size > 0)
      .sort((left, right) => left.bbox.x - right.bbox.x || left.bbox.y - right.bbox.y)
      .map((element, index) => [element.id, index] as const),
  );
  const evidenceBulletByIndex = new Map(
    elements
      .filter((element) => evidenceBulletIds.has(element.id))
      .map((element) => [evidenceBulletIds.get(element.id) ?? 0, element] as const),
  );
  const evidenceCardLayout = new Map<string, { y: number; height: number }>();
  const evidenceBulletLayout = new Map<string, { y: number; height: number }>();
  let evidenceCursor = 0.4;
  for (const [cardId, cardIndex] of evidenceCardIds) {
    const bullet = evidenceBulletByIndex.get(cardIndex);
    const bulletHeight = bullet
      ? Math.max(
          0.07,
          estimateTextHeight(
            bullet.content ?? '',
            bullet.style.fontSize ?? 16,
            bullet.style.lineHeight ?? 1.25,
            0.58,
          ) * 1.1,
        )
      : 0.07;
    const cardHeight = Math.max(0.11, bulletHeight + 0.04);
    evidenceCardLayout.set(cardId, { y: evidenceCursor, height: cardHeight });
    if (bullet) {
      evidenceBulletLayout.set(bullet.id, { y: evidenceCursor + 0.02, height: bulletHeight });
    }
    evidenceCursor += cardHeight + 0.02;
  }
  const diagramNodeIds = new Map(
    elements
      .filter(
        (element) => element.role?.startsWith('diagram_') === true && element.kind === 'shape',
      )
      .sort((left, right) => left.bbox.x - right.bbox.x || left.bbox.y - right.bbox.y)
      .map((element, index) => [element.id, index] as const),
  );
  const diagramEdgeIds = new Map(
    elements
      .filter((element) => element.role === 'diagram_edge')
      .sort((left, right) => left.bbox.x - right.bbox.x || left.bbox.y - right.bbox.y)
      .map((element, index) => [element.id, index] as const),
  );
  const comparisonSectionIds = new Map(
    elements
      .filter((element) => element.role === 'section' && element.bbox.y > 0.2)
      .sort((left, right) => left.bbox.x - right.bbox.x)
      .map((element, index) => [element.id, index] as const),
  );
  const comparisonBulletIds = new Map(
    elements
      .filter((element) => element.role === 'bullet' && comparisonSectionIds.size >= 2)
      .sort((left, right) => left.bbox.x - right.bbox.x)
      .map((element, index) => [element.id, index] as const),
  );
  const comparisonRuleIds = new Map(
    elements
      .filter(
        (element) =>
          element.role === 'decoration' &&
          element.bbox.height > 0.1 &&
          comparisonSectionIds.size >= 2,
      )
      .sort((left, right) => left.bbox.x - right.bbox.x)
      .map((element, index) => [element.id, index] as const),
  );
  const comparisonRailX = slideIndex % 3 === 0 ? 0.08 : 0.56;
  const diagramRailX = slideIndex % 4 === 0 ? 0.56 : 0.08;
  return cloneElements(elements).map((element) => {
    if (comparisonSectionIds.has(element.id)) {
      const sectionIndex = comparisonSectionIds.get(element.id) ?? 0;
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: comparisonRailX,
          y: 0.34 + sectionIndex * 0.17,
          width: 0.36,
          height: 0.05,
        },
      };
    }
    if (comparisonBulletIds.has(element.id)) {
      const bulletIndex = comparisonBulletIds.get(element.id) ?? 0;
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: comparisonRailX,
          y: 0.39 + bulletIndex * 0.17,
          width: 0.36,
          height: Math.max(0.09, element.bbox.height),
        },
      };
    }
    if (comparisonRuleIds.has(element.id)) {
      const ruleIndex = comparisonRuleIds.get(element.id) ?? 0;
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: comparisonRailX,
          y: 0.495 + ruleIndex * 0.17,
          width: 0.36,
          height: 0.002,
        },
      };
    }
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
      if (comparisonSectionIds.size >= 2) {
        return {
          ...element,
          bbox: {
            ...element.bbox,
            x: comparisonRailX < 0.5 ? 0.52 : 0.07,
            y: 0.2,
            width: 0.4,
            height: Math.max(0.34, element.bbox.height),
          },
          style: { ...element.style, textAlign: 'left' },
        };
      }
      const focusedHeadlineWidth = hasPrimaryVisual ? 0.42 : 0.72;
      const focusedHeadlineHeight =
        estimateTextHeight(
          element.content ?? '',
          element.style.fontSize ?? 16,
          element.style.lineHeight ?? 1.05,
          focusedHeadlineWidth,
        ) * 1.25;
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: hasPrimaryVisual ? (primaryVisualOnLeft ? 0.5 : 0.08) : 0.14,
          y: hasPrimaryVisual ? 0.15 : 0.18,
          width: focusedHeadlineWidth,
          height: Math.max(
            hasPrimaryVisual ? 0.17 : 0.18,
            element.bbox.height,
            focusedHeadlineHeight,
          ),
        },
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
    if (evidenceCardIds.size > 0 && element.role === 'evidence_card') {
      const layout = evidenceCardLayout.get(element.id) ?? { y: element.bbox.y, height: 0.11 };
      return {
        ...element,
        bbox: { ...element.bbox, x: 0.18, y: layout.y, width: 0.64, height: layout.height },
      };
    }
    if (evidenceCardIds.size > 0 && element.role === 'bullet') {
      const layout = evidenceBulletLayout.get(element.id) ?? { y: element.bbox.y, height: 0.07 };
      return {
        ...element,
        bbox: { ...element.bbox, x: 0.21, y: layout.y, width: 0.58, height: layout.height },
        style: { ...element.style, textAlign: 'left' },
      };
    }
    if (diagramNodeIds.size > 0 && diagramNodeIds.has(element.id)) {
      const nodeIndex = diagramNodeIds.get(element.id) ?? 0;
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: diagramRailX,
          y: 0.38 + nodeIndex * 0.15,
          width: 0.34,
          height: 0.1,
        },
      };
    }
    if (diagramEdgeIds.has(element.id)) {
      const edgeIndex = diagramEdgeIds.get(element.id) ?? 0;
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: diagramRailX + 0.16,
          y: 0.48 + edgeIndex * 0.15,
          width: 0.02,
          height: 0.05,
        },
        rotation: 90,
      };
    }
    if (diagramNodeIds.size > 0 && element.role === 'body') {
      const focusedBodyHeight = Math.min(
        0.4,
        Math.max(
          0.24,
          estimateTextHeight(
            element.content ?? '',
            element.style.fontSize ?? 16,
            element.style.lineHeight ?? 1.35,
            0.38,
          ) * 1.15,
        ),
      );
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: diagramRailX < 0.5 ? 0.52 : 0.08,
          y: 0.4,
          width: 0.38,
          height: focusedBodyHeight,
        },
      };
    }
    if (diagramNodeIds.size > 0 && element.role === 'bullet') {
      const bulletIndex = textOnlyBulletIds.get(element.id) ?? 0;
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: diagramRailX < 0.5 ? 0.52 : 0.08,
          y: 0.64 + bulletIndex * 0.1,
          width: 0.38,
          height: Math.max(0.08, element.bbox.height),
        },
      };
    }
    if (!hasPrimaryVisual && element.role === 'body') {
      const focusedBodyHeight = Math.min(
        0.24,
        Math.max(
          0.16,
          estimateTextHeight(
            element.content ?? '',
            element.style.fontSize ?? 16,
            element.style.lineHeight ?? 1.35,
            0.6,
          ) * 1.15,
        ),
      );
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: 0.2,
          y: 0.45,
          width: 0.6,
          height: focusedBodyHeight,
        },
        style: { ...element.style, textAlign: 'center' },
      };
    }
    if (!hasPrimaryVisual && element.role === 'bullet') {
      const bulletIndex = textOnlyBulletIds.get(element.id) ?? 0;
      const bulletCount = Math.max(1, textOnlyBulletIds.size);
      const width = bulletCount === 1 ? 0.46 : Math.min(0.25, 0.78 / bulletCount);
      const gap = bulletCount === 1 ? 0 : (0.78 - width * bulletCount) / (bulletCount - 1);
      const focusedBulletHeight =
        estimateTextHeight(
          element.content ?? '',
          element.style.fontSize ?? 16,
          element.style.lineHeight ?? 1.2,
          width,
        ) * 1.1;
      return {
        ...element,
        bbox: {
          ...element.bbox,
          x: bulletCount === 1 ? 0.27 : 0.11 + bulletIndex * (width + gap),
          y: 0.7,
          width,
          height: Math.max(0.1, element.bbox.height, focusedBulletHeight),
        },
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
  const semanticOrderPenalty =
    input.variant === 'mirrored' && hasOrderSensitiveHorizontalSequence(input.elements) ? 1_000 : 0;
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
        outOfBoundsCount * 50 -
        semanticOrderPenalty
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
    ['visual-focus', focusPrimaryVisual(input.elements, input.plan.slideIndex)],
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
    (left, right) =>
      left.summary.outOfBoundsCount - right.summary.outOfBoundsCount ||
      left.summary.overlapCount - right.summary.overlapCount ||
      right.summary.score - left.summary.score,
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
