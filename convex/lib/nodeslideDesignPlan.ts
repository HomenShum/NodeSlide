import type { SlideArchetype } from '../../shared/nodeslide';
import { type SlideContentShape, chooseDeckArchetypes } from '../../shared/nodeslideArchetypes';
import type { NodeSlidePlannedSlide } from './nodeslideSeed';
import type { NodeSlideStorySpec, NodeSlideVisualMaterialKind } from './nodeslideStoryContext';

export type NodeSlideDesignDensity = 'sparse' | 'balanced' | 'dense';
export type NodeSlideVisualCenter =
  | 'headline'
  | 'metric'
  | 'chart'
  | 'diagram'
  | 'formula'
  | 'media'
  | 'comparison';

export interface NodeSlideCompositionReference {
  id: string;
  archetype: SlideArchetype;
  layoutFamily: string;
  dominantRegion: string;
  density: NodeSlideDesignDensity;
  useWhen: string;
  avoidWhen: string;
}

export interface NodeSlideDesignPlan {
  slideIndex: number;
  narrativeJob: string;
  semanticArchetype: SlideArchetype;
  dominantVisualCenter: NodeSlideVisualCenter;
  requiredArtifacts: NodeSlideVisualMaterialKind[];
  requiredMaterialIds: string[];
  referenceIds: string[];
  density: NodeSlideDesignDensity;
  compositionIntent: string;
  forbiddenPatterns: string[];
}

type ReferenceSeed = readonly [
  layoutFamily: string,
  dominantRegion: string,
  density: NodeSlideDesignDensity,
  useWhen: string,
  avoidWhen: string,
];

const COMMON_REFERENCES: Record<SlideArchetype, readonly ReferenceSeed[]> = {
  statement: [
    [
      'single-thesis',
      'center field',
      'sparse',
      'One decisive takeaway opens or closes the story.',
      'The slide needs supporting evidence or multiple claims.',
    ],
    [
      'asymmetric-thesis',
      'left two-thirds',
      'sparse',
      'A short claim benefits from deliberate negative space.',
      'Copy needs more than one supporting sentence.',
    ],
    [
      'thesis-with-proof-line',
      'upper field',
      'balanced',
      'One claim needs a restrained evidence footer.',
      'The evidence is the primary visual rather than support.',
    ],
    [
      'closing-decision',
      'lower-left decision field',
      'sparse',
      'The audience must leave with one owner or next move.',
      'The ending is exploratory or question-led.',
    ],
  ],
  split: [
    [
      'argument-and-support',
      'balanced halves',
      'balanced',
      'A claim and its explanation need equal weight.',
      'Either side would be empty or purely decorative.',
    ],
    [
      'claim-with-formula',
      'right proof field',
      'balanced',
      'A structured equation proves the left-side claim.',
      'The equation lacks grounded inputs.',
    ],
    [
      'text-and-evidence-rail',
      'wide claim plus narrow rail',
      'balanced',
      'Supporting facts should stay subordinate to the thesis.',
      'The rail needs more than three evidence items.',
    ],
    [
      'offset-editorial',
      'staggered left/right fields',
      'sparse',
      'Short copy needs a less mechanical editorial rhythm.',
      'Dense bullets would destroy the silhouette.',
    ],
  ],
  comparison: [
    [
      'two-position-contrast',
      'equal opposing columns',
      'balanced',
      'Two alternatives or before/after states are directly comparable.',
      'The categories are not commensurate.',
    ],
    [
      'three-lens-comparison',
      'three vertical fields',
      'balanced',
      'Three concise dimensions form the argument.',
      'Any dimension needs paragraph-length copy.',
    ],
    [
      'weighted-choice',
      'dominant recommendation plus alternative',
      'balanced',
      'One option is recommended and another is contextual.',
      'The analysis is neutral and should not imply a winner.',
    ],
    [
      'criteria-matrix',
      'top claim plus aligned rows',
      'dense',
      'Repeated criteria must line up for scanning.',
      'There are fewer than two comparable criteria.',
    ],
  ],
  'stat-dominant': [
    [
      'hero-number',
      'center metric field',
      'sparse',
      'One number carries the core implication.',
      'The number is illustrative or unsupported.',
    ],
    [
      'metric-with-interpretation',
      'left metric plus right meaning',
      'balanced',
      'The audience needs both magnitude and consequence.',
      'The interpretation repeats the headline.',
    ],
    [
      'three-stat-rhythm',
      'three aligned metric fields',
      'balanced',
      'A small set of comparable metrics advances one claim.',
      'Units or denominators differ materially.',
    ],
    [
      'metric-and-trend',
      'upper metric plus lower trend',
      'balanced',
      'A number needs temporal context.',
      'No time series was supplied.',
    ],
  ],
  'chart-dominant': [
    [
      'wide-chart',
      'full-width evidence field',
      'balanced',
      'The chart itself is the primary proof.',
      'The series cannot be read without long prose.',
    ],
    [
      'chart-with-insight-rail',
      'two-thirds chart plus insight rail',
      'balanced',
      'Two or three implications should sit beside the data.',
      'The rail would duplicate chart labels.',
    ],
    [
      'chart-with-callout',
      'large plot plus one annotated point',
      'sparse',
      'One inflection or outlier changes the conclusion.',
      'No point deserves privileged emphasis.',
    ],
    [
      'small-multiple-comparison',
      'aligned plot fields',
      'dense',
      'Comparable series need repeated scales.',
      'The series use incompatible scales.',
    ],
  ],
  'diagram-dominant': [
    [
      'horizontal-process',
      'center horizontal flow',
      'balanced',
      'A short causal or sequential path is central.',
      'More than five nodes would crowd the path.',
    ],
    [
      'vertical-system-stack',
      'center vertical stack',
      'balanced',
      'Layers or dependencies read top-to-bottom.',
      'The relationships are primarily cyclical.',
    ],
    [
      'architecture-with-boundary',
      'system field plus explicit boundary',
      'dense',
      'Ownership or trust boundaries matter.',
      'The brief supplies no system boundary.',
    ],
    [
      'timeline-with-decision',
      'horizontal time rail',
      'balanced',
      'Milestones culminate in a decision.',
      'Sequence is not meaningful to the claim.',
    ],
  ],
  'media-dominant': [
    [
      'full-bleed-evidence',
      'full canvas media',
      'sparse',
      'A real image or screenshot is the evidence.',
      'Only a placeholder or illustrative asset exists.',
    ],
    [
      'media-with-caption-rail',
      'two-thirds media plus caption rail',
      'balanced',
      'Provenance and interpretation must remain adjacent.',
      'The caption would merely describe what is visible.',
    ],
    [
      'cropped-detail',
      'large evidence crop plus locator',
      'balanced',
      'One exact region proves the claim.',
      'No stable crop or source region is available.',
    ],
    [
      'paired-media',
      'two aligned media fields',
      'balanced',
      'A before/after or direct visual comparison is required.',
      'The two assets have unrelated framing.',
    ],
  ],
};

export const NODESLIDE_COMPOSITION_REFERENCES: readonly NodeSlideCompositionReference[] =
  Object.entries(COMMON_REFERENCES).flatMap(([archetype, seeds]) =>
    seeds.map(([layoutFamily, dominantRegion, density, useWhen, avoidWhen], index) => ({
      id: `nodeslide-ref/${archetype}/${index + 1}-${layoutFamily}`,
      archetype: archetype as SlideArchetype,
      layoutFamily,
      dominantRegion,
      density,
      useWhen,
      avoidWhen,
    })),
  );

function contentShapes(slides: readonly NodeSlidePlannedSlide[]): SlideContentShape[] {
  return slides.map((slide, index) => ({
    index,
    total: slides.length,
    hasMetric: slide.metric !== undefined,
    hasChart: slide.chart !== undefined,
    hasDiagram: slide.diagram !== undefined,
    hasMedia: slide.image !== undefined || slide.video !== undefined,
    hasFormula: slide.formula !== undefined,
    bulletCount: slide.bullets.filter(Boolean).length,
  }));
}

function visualCenter(
  slide: NodeSlidePlannedSlide,
  archetype: SlideArchetype,
): NodeSlideVisualCenter {
  if (slide.image || slide.video) return 'media';
  if (slide.chart) return 'chart';
  if (slide.diagram) return 'diagram';
  if (slide.formula) return 'formula';
  if (slide.metric) return 'metric';
  if (archetype === 'comparison') return 'comparison';
  return 'headline';
}

function artifacts(slide: NodeSlidePlannedSlide): NodeSlideVisualMaterialKind[] {
  return [
    ...(slide.chart ? (['numeric-series'] as const) : []),
    ...(slide.diagram ? (['diagram'] as const) : []),
    ...(slide.formula ? (['formula'] as const) : []),
    ...(slide.image ? (['image'] as const) : []),
  ];
}

function density(slide: NodeSlidePlannedSlide): NodeSlideDesignDensity {
  const textLoad = slide.headline.length + slide.body.length + slide.bullets.join(' ').length;
  if (textLoad > 460 || slide.bullets.length > 3) return 'dense';
  if (textLoad > 220 || slide.bullets.length > 1) return 'balanced';
  return 'sparse';
}

export function buildNodeSlideDesignPlans(input: {
  slides: readonly NodeSlidePlannedSlide[];
  storySpec?: NodeSlideStorySpec;
}): NodeSlideDesignPlan[] {
  const archetypes = chooseDeckArchetypes(contentShapes(input.slides));
  return input.slides.map((slide, slideIndex) => {
    const semanticArchetype = archetypes[slideIndex] ?? 'split';
    const requiredArtifacts = artifacts(slide);
    const references = NODESLIDE_COMPOSITION_REFERENCES.filter(
      (reference) => reference.archetype === semanticArchetype,
    ).slice(0, 4);
    const requiredMaterialIds =
      input.storySpec?.proofObligations
        .filter((obligation) =>
          obligation.requiredMaterialKinds.some((kind) => requiredArtifacts.includes(kind)),
        )
        .flatMap((obligation) => obligation.materialIds) ?? [];
    return {
      slideIndex,
      narrativeJob: slide.headline,
      semanticArchetype,
      dominantVisualCenter: visualCenter(slide, semanticArchetype),
      requiredArtifacts,
      requiredMaterialIds: [...new Set(requiredMaterialIds)],
      referenceIds: references.map((reference) => reference.id),
      density: density(slide),
      compositionIntent: `Make ${visualCenter(slide, semanticArchetype)} the visual center so the audience can ${slide.headline.replace(/[.!?]+$/u, '').toLocaleLowerCase()}.`,
      forbiddenPatterns: [
        'more than one dominant visual',
        'decorative evidence without provenance',
        'repeated card-grid silhouette',
        ...(semanticArchetype === 'media-dominant'
          ? ['placeholder presented as captured media']
          : []),
      ],
    };
  });
}
