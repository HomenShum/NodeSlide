export const ATLAS_V2_VERSION = 'artifact-atlas-v2';

export const ATLAS_V2_THEMES = {
  'editorial-evidence': {
    canvas: '#F4EFE7',
    ink: '#17231E',
    muted: '#667069',
    accent: '#C45538',
    accent2: '#287A78',
    soft: '#E4DDD2',
    panel: '#FBF8F2',
    danger: '#A63B32',
  },
  'executive-minimal': {
    canvas: '#F8F9FA',
    ink: '#12181D',
    muted: '#66727A',
    accent: '#145DA0',
    accent2: '#3A7D44',
    soft: '#DFE8EF',
    panel: '#FFFFFF',
    danger: '#B23A48',
  },
  'technical-dark': {
    canvas: '#0D1522',
    ink: '#F4F1E8',
    muted: '#A2B0C1',
    accent: '#B7E36B',
    accent2: '#A98BFF',
    soft: '#233046',
    panel: '#151F31',
    danger: '#FF7A70',
  },
  'research-publication': {
    canvas: '#FCFAF5',
    ink: '#232220',
    muted: '#6D6860',
    accent: '#8B2F3C',
    accent2: '#315E72',
    soft: '#E9E4DA',
    panel: '#FFFFFF',
    danger: '#9D2F2F',
  },
  'financial-institutional': {
    canvas: '#F2F5F3',
    ink: '#102A2A',
    muted: '#667574',
    accent: '#0F6B5C',
    accent2: '#B08D3A',
    soft: '#DCE7E2',
    panel: '#FFFFFF',
    danger: '#A64135',
  },
  'product-launch-cinematic': {
    canvas: '#111018',
    ink: '#FFF7ED',
    muted: '#BDB3C7',
    accent: '#FF8A5B',
    accent2: '#7FE0D0',
    soft: '#2B2636',
    panel: '#1C1926',
    danger: '#FF6A70',
  },
  'playful-consumer': {
    canvas: '#FFF6E9',
    ink: '#29233B',
    muted: '#746C82',
    accent: '#F05D7A',
    accent2: '#4B9FE1',
    soft: '#F3DCCB',
    panel: '#FFFFFF',
    danger: '#C33F58',
  },
};

const DEFAULT_FALLBACK = {
  web: 'Native interactive composition with semantic reading order.',
  pptx: 'Editable text, shapes, charts, and image frames; stepped states replace motion.',
  powerpoint: 'Editable text, shapes, charts, and image frames; stepped states replace motion.',
  pdf: 'Static high-resolution composition with visible source and receipt labels.',
  reducedMotion: 'Show the final state with numbered steps and no automatic movement.',
};

const rows = [
  [
    '01',
    'narrative-foundations',
    'hero-thesis',
    'hero',
    'Reviewability turns generation into a product decision',
    'One evidence-bounded thesis anchors the complete visual vocabulary.',
    'editorial-evidence',
  ],
  [
    '02',
    'narrative-foundations',
    'section-opener',
    'section',
    'A museum needs chapters, not a wall of thumbnails',
    'Six chapters organize artifacts by the job they perform for an audience.',
    'product-launch-cinematic',
  ],
  [
    '03',
    'narrative-foundations',
    'big-metric',
    'metric',
    '82 of 84 candidates cleared browser and PowerPoint proof',
    'The headline metric stays tied to the frozen Arena receipt instead of becoming marketing shorthand.',
    'executive-minimal',
  ],
  [
    '04',
    'narrative-foundations',
    'customer-voice',
    'quote',
    'The useful promise is editable evidence, not instant polish',
    'A customer-voice treatment demonstrates editorial rhythm without inventing a customer.',
    'research-publication',
  ],
  [
    '05',
    'narrative-foundations',
    'before-after-story',
    'before-after',
    'The harness removes clutter before it adds decoration',
    'Before and after states identify the exact components that changed and why.',
    'playful-consumer',
  ],
  [
    '06',
    'data',
    'kpi-strip',
    'kpi',
    'The operating verdict should scan in under five seconds',
    'Five metrics preserve actual, prior, target, variance, and status context.',
    'executive-minimal',
  ],
  [
    '07',
    'data',
    'multi-series-trend',
    'line',
    'Direct labels make divergence visible without inventing a cause',
    'Three series share one scale and one evidence-bounded takeaway.',
    'editorial-evidence',
  ],
  [
    '08',
    'data',
    'uncertainty-range',
    'uncertainty',
    'A forecast is more credible when its range is impossible to miss',
    'Observed values, base case, and widening modeled bounds remain editable.',
    'financial-institutional',
  ],
  [
    '09',
    'data',
    'waterfall',
    'waterfall',
    'Harness gains come from several small controls, not one magic prompt',
    'A contribution bridge separates planning, tools, repair, and validation effects.',
    'financial-institutional',
  ],
  [
    '10',
    'data',
    'quality-cost-scatter',
    'scatter',
    'The best route sits on a frontier, not at one universal optimum',
    'Bubble size adds latency to the quality-versus-cost comparison.',
    'technical-dark',
  ],
  [
    '11',
    'data',
    'operating-table-sparklines',
    'table',
    'Dense tables stay readable when hierarchy does the filtering',
    'Actual, plan, variance, trend, and status share one executive artifact.',
    'executive-minimal',
  ],
  [
    '12',
    'data',
    'dense-dashboard-funnel',
    'dashboard',
    'A dashboard can be dense without becoming a card graveyard',
    'A funnel, trend, exceptions, and decision queue share one controlled surface.',
    'financial-institutional',
  ],
  [
    '13',
    'systems',
    'system-architecture',
    'architecture',
    'The portable protocol keeps product logic above backend choice',
    'Typed connectors and a visible trust boundary preserve system meaning.',
    'technical-dark',
  ],
  [
    '14',
    'systems',
    'request-sequence',
    'sequence',
    'Review custody is visible at every handoff',
    'The happy path and failed-validation return path remain distinct.',
    'research-publication',
  ],
  [
    '15',
    'systems',
    'causal-loop',
    'causal',
    'Better receipts reinforce trust; unchecked complexity pushes back',
    'Reinforcing and balancing loops explain behavior that a flowchart cannot.',
    'editorial-evidence',
  ],
  [
    '16',
    'systems',
    'source-allocation-sankey',
    'sankey',
    'Every visual can retain the path from source to slide',
    'Allocation bands show evidence flowing through claims into visual forms.',
    'technical-dark',
  ],
  [
    '17',
    'systems',
    'routing-decision-tree',
    'decision-tree',
    'Routing should spend capability only where the task needs it',
    'A decision tree distinguishes deterministic, cheap-model, and orchestrator paths.',
    'executive-minimal',
  ],
  [
    '18',
    'systems',
    'ecosystem-geography',
    'ecosystem',
    'NodeKit connects the stack while NodeSlide proves the journey',
    'An ecosystem landscape includes a geospatial deployment inset without confusing categories.',
    'playful-consumer',
  ],
  [
    '19',
    'progression',
    'research-timeline',
    'timeline',
    'Human approval remains the gate between experiment and harness change',
    'Time-proportional milestones make the review gate explicit.',
    'editorial-evidence',
  ],
  [
    '20',
    'progression',
    'roadmap-gantt',
    'gantt',
    'The next release sequence exposes dependencies and confidence',
    'Workstreams, milestones, dependencies, status, and confidence share one roadmap.',
    'executive-minimal',
  ],
  [
    '21',
    'progression',
    'evidence-scrollytelling',
    'scrolly',
    'Evidence becomes a decision through five inspectable states',
    'The web version scrubs; PowerPoint shows the same numbered progression.',
    'product-launch-cinematic',
  ],
  [
    '22',
    'progression',
    'animated-chart-progression',
    'chart-states',
    'The trend means more when the audience sees the baseline move',
    'Four chart states compare baseline, model, harness, and refreshed evidence.',
    'technical-dark',
  ],
  [
    '23',
    'product-media',
    'full-bleed-editorial-image',
    'full-bleed',
    'A visual story can lead with atmosphere and still preserve proof',
    'A generated rights-clearable image uses focal crop, credit, and an editable frame.',
    'product-launch-cinematic',
  ],
  [
    '24',
    'product-media',
    'real-screenshot-callouts',
    'screenshot',
    'The product proof is the interface people actually use',
    'A real NodeSlide capture occupies most of the slide with three exact callouts.',
    'editorial-evidence',
  ],
  [
    '25',
    'product-media',
    'interaction-clip',
    'interaction',
    'One bounded interaction carries the story from selection to receipt',
    'Five real product states form a playable web sequence and a stepped PowerPoint fallback.',
    'technical-dark',
  ],
  [
    '26',
    'product-media',
    'product-before-after',
    'product-compare',
    'Review transforms a rough generation into a governed workspace',
    'Actual captures identify changed components and the measured workflow outcome.',
    'playful-consumer',
  ],
  [
    '27',
    'product-media',
    'spatial-scene',
    'spatial',
    'The canvas can move from whole system to exact evidence',
    'A spatial depth treatment previews zoom from system, to node, to trace, to source.',
    'product-launch-cinematic',
  ],
  [
    '28',
    'evidence-technical-proof',
    'claim-source-lineage',
    'lineage',
    'A claim is trustworthy when its entire path remains inspectable',
    'Source, extraction, bounded claim, slide element, and receipt stay connected.',
    'research-publication',
  ],
  [
    '29',
    'evidence-technical-proof',
    'pdf-evidence-region',
    'pdf',
    'Citation quality depends on the exact source region',
    'A PDF-region artifact binds highlighted evidence to the claim it supports.',
    'research-publication',
  ],
  [
    '30',
    'evidence-technical-proof',
    'code-runtime-proof',
    'code',
    'The contract matters more when runtime evidence sits beside it',
    'Editable code context and measured adapter latency reinforce each other.',
    'technical-dark',
  ],
  [
    '31',
    'evidence-technical-proof',
    'otel-trace',
    'trace',
    'A trace shows where orchestration time and repair actually went',
    'Nested spans expose planning, tools, validation, repair, and export.',
    'technical-dark',
  ],
  [
    '32',
    'evidence-technical-proof',
    'quality-cost-equation',
    'equation',
    'The score is only useful when every symbol maps to evidence',
    'Real mathematics, definitions, and a bound calculation share one frame.',
    'research-publication',
  ],
  [
    '33',
    'evidence-technical-proof',
    'deck-ci-receipt',
    'ci',
    'A deck is not done until both pixels and semantics pass',
    'The receipt exposes every check, browser proof, PowerPoint proof, and fidelity difference.',
    'executive-minimal',
  ],
  [
    '34',
    'decision-evaluation',
    'risk-matrix',
    'risk',
    'Pipeline coverage is the risk that deserves action first',
    'Likelihood and impact preserve priority better than an unlabeled list.',
    'financial-institutional',
  ],
  [
    '35',
    'decision-evaluation',
    'cost-quality-frontier',
    'frontier',
    'Routing improves when quality, cost, and latency are judged together',
    'The observed routes stay separate from the not-yet-run ensemble.',
    'technical-dark',
  ],
  [
    '36',
    'decision-evaluation',
    'model-compare',
    'model-compare',
    'Different models fail differently under the same contract',
    'Observed outputs compare adherence, primitive choice, repairs, latency, cost, and export truth.',
    'executive-minimal',
  ],
  [
    '37',
    'decision-evaluation',
    'harness-compare',
    'harness-compare',
    'V2 expands the harness without crediting the model',
    'The same deterministic route isolates fixture, receipt, motion, theme, and accessibility gains.',
    'editorial-evidence',
  ],
  [
    '38',
    'decision-evaluation',
    'final-recommendation',
    'recommendation',
    'Reuse the visual vocabulary, then adapt the communication contract',
    'Researcher, investor, and plain-language Chinese versions share the same evidence.',
    'product-launch-cinematic',
  ],
];

const interactiveFamilies = new Set(['scrolly', 'chart-states', 'interaction', 'spatial']);

export const ATLAS_V2_ARTIFACTS = rows.map(
  ([number, chapter, id, family, title, takeaway, theme], index) => ({
    number,
    chapter,
    id,
    artifactType: id,
    slideArchetype: family,
    family,
    title,
    takeaway,
    theme,
    narrativeJob: takeaway,
    evidence: evidenceFor(id, index),
    allowedClaims: claimsFor(id),
    forbiddenClaims: ['fully autonomous', 'zero errors', 'automatic promotion'],
    referenceIds: [`atlas-v2-${family}`, `chapter-${chapter}`],
    recipe: {
      recipeId: `nodeslide.recipe.${id}.v2`,
      artifactType: id,
      narrativeJobs: [takeaway],
      requiredInputs: ['audience', 'bounded claim', 'source receipt'],
      supportedTools: toolsFor(family),
      referenceIds: [`atlas-v2-${family}`, `chapter-${chapter}`],
      designRules: designRulesFor(family),
      exportCapabilities: ['browser', 'pptx', 'pdf'],
    },
    behavior: {
      ...DEFAULT_FALLBACK,
      interactive: interactiveFamilies.has(family),
      web: interactiveFamilies.has(family)
        ? `${DEFAULT_FALLBACK.web} Supports step, scrub, or zoom controls.`
        : DEFAULT_FALLBACK.web,
    },
    accessibility: {
      altText: `${title}. ${takeaway}`,
      readingOrder: 'title, primary visual, evidence annotation, source, receipt',
      highContrast: true,
      reducedMotion: true,
      mobile: 'Single-column semantic stack with the visual before detail.',
      presenterNotes: true,
      sourceHover: true,
    },
  }),
);

export const ATLAS_V2_SHOWCASE_IDS = [
  'hero-thesis',
  'evidence-scrollytelling',
  'real-screenshot-callouts',
  'request-sequence',
  'dense-dashboard-funnel',
  'cost-quality-frontier',
  'system-architecture',
  'interaction-clip',
  'product-before-after',
  'claim-source-lineage',
  'harness-compare',
  'deck-ci-receipt',
  'animated-chart-progression',
  'final-recommendation',
];

export const ATLAS_V2_THEME_VARIANT_IDS = [
  'hero-thesis',
  'dense-dashboard-funnel',
  'system-architecture',
  'real-screenshot-callouts',
];

export const ATLAS_V2_THEME_VARIANTS = [
  'editorial-evidence',
  'technical-dark',
  'financial-institutional',
];

export const ATLAS_V2_DOMAIN_PACKS = [
  [
    'founder-roadshow',
    'startup-roadshow',
    ['problem', 'insight', 'product', 'architecture', 'proof', 'market', 'business-model', 'ask'],
  ],
  [
    'research-talk',
    'research-talk',
    [
      'question',
      'prior-work',
      'method',
      'equation',
      'experiment',
      'results',
      'limitations',
      'implications',
    ],
  ],
  [
    'board-operating-review',
    'executive-update',
    ['summary', 'kpis', 'actual-v-plan', 'drivers', 'risks', 'decisions', 'outlook'],
  ],
  [
    'technical-architecture-review',
    'technical-architecture',
    [
      'requirements',
      'context',
      'architecture',
      'sequence',
      'data-model',
      'concurrency',
      'failures',
      'benchmarks',
      'decision',
    ],
  ],
  [
    'investment-finance',
    'finance-investment',
    [
      'thesis',
      'market',
      'performance',
      'unit-economics',
      'scenarios',
      'risks',
      'valuation',
      'recommendation',
    ],
  ],
  [
    'product-launch',
    'product-demo',
    [
      'tension',
      'experience',
      'demonstration',
      'how-it-works',
      'proof',
      'rollout',
      'call-to-action',
    ],
  ],
].map(([id, existingPack, arc]) => ({
  id,
  existingPack,
  arc,
  contactSheet: `artifacts/deck-gym/deck-gym-v1/contact-sheets/${existingPack}__evidence-editorial.png`,
  status: 'generated-existing-deck-gym-evidence',
}));

function evidenceFor(id, index) {
  return [
    {
      sourceId: `atlas-v2-${id}`,
      label: 'Frozen NodeSlide capability evidence',
      content: `${index + 1} of 38 canonical Atlas V2 artifacts. Browser and native PowerPoint outputs are generated from the same semantic primitive plan.`,
    },
  ];
}

function claimsFor(id) {
  const common = [
    'browser output',
    'PowerPoint output',
    'editable semantics',
    'human preference pending',
  ];
  if (id === 'big-metric')
    return ['84 plans generated', '82 browser and PowerPoint eligible artifacts'];
  if (id === 'model-compare')
    return ['Claude 24 of 24 eligible', 'Gemma 23 of 24 eligible', 'Kimi 23 of 24 eligible'];
  if (id === 'harness-compare') return ['12 fixtures in v1', '38 canonical artifacts in v2'];
  return common;
}

function toolsFor(family) {
  const tools = ['semantic-primitives', 'pptxgenjs', 'playwright'];
  if (['line', 'uncertainty', 'waterfall', 'scatter', 'frontier'].includes(family))
    tools.push('chart-builder');
  if (['screenshot', 'interaction', 'product-compare', 'full-bleed'].includes(family))
    tools.push('media-frame');
  if (family === 'equation') tools.push('katex');
  if (['architecture', 'sequence', 'causal', 'sankey', 'decision-tree', 'lineage'].includes(family))
    tools.push('diagram-builder');
  return tools;
}

function designRulesFor(family) {
  const rules = ['one primary claim', 'visible source', 'editable PowerPoint semantics'];
  if (['dashboard', 'table'].includes(family))
    rules.push('controlled density', 'exception-first hierarchy');
  if (interactiveFamilies.has(family))
    rules.push('visible static fallback', 'reduced-motion final state');
  if (['screenshot', 'product-compare'].includes(family))
    rules.push('real capture only', 'callouts must bind to visible controls');
  return rules;
}
