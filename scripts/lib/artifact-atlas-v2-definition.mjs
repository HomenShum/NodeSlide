import { artifactSpecEnvelope } from './artifact-spec-core.mjs';

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
    'Seven chapters organize artifacts by the job they perform for an audience.',
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
    'Three captured product states anchor a five-step workflow and its PowerPoint fallback.',
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
    'Runtime claims require a reproducible benchmark receipt',
    'Editable code context stays separate from latency until samples and environment are bound.',
    'technical-dark',
  ],
  [
    '31',
    'evidence-technical-proof',
    'otel-trace',
    'trace',
    'Trace anatomy is illustrative until trace and span IDs are bound',
    'Nested spans explain the required structure without claiming observed timing.',
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

const ATLAS_V2_BASE_ARTIFACTS = rows.map(
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
      requiredInputs: requiredInputsFor(family),
      supportedTools: toolsFor(family),
      referenceIds: [`atlas-v2-${family}`, `chapter-${chapter}`],
      designRules: designRulesFor(family, id),
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

export const ATLAS_V2_ARTIFACTS = ATLAS_V2_BASE_ARTIFACTS.map((artifact) => ({
  ...artifact,
  artifactSpec: artifactSpecEnvelope(artifact, specKindFor(artifact), specPayloadFor(artifact)),
}));

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

function requiredInputsFor(family) {
  const inputs = ['audience', 'bounded claim', 'source receipt'];
  if (
    ['line', 'uncertainty', 'waterfall', 'scatter', 'frontier', 'dashboard', 'table'].includes(
      family,
    )
  )
    inputs.push('typed data', 'unit', 'scale policy');
  if (['architecture', 'sequence', 'causal', 'sankey', 'decision-tree', 'lineage'].includes(family))
    inputs.push('typed nodes', 'typed edges', 'reading direction');
  if (['screenshot', 'interaction', 'product-compare', 'pdf'].includes(family))
    inputs.push('immutable media digest', 'capture version', 'claim region');
  if (['scrolly', 'chart-states', 'interaction', 'spatial'].includes(family))
    inputs.push('named states', 'transition policy', 'static fallback state');
  if (family === 'equation') inputs.push('expression AST', 'symbol values', 'rounding policy');
  return inputs;
}

function designRulesFor(family, id) {
  const rules = ['one primary claim', 'visible source', 'editable PowerPoint semantics'];
  if (['dashboard', 'table'].includes(family))
    rules.push('controlled density', 'exception-first hierarchy');
  if (interactiveFamilies.has(family))
    rules.push('visible static fallback', 'reduced-motion final state');
  if (['screenshot', 'product-compare'].includes(family))
    rules.push('real capture only', 'callouts must bind to visible controls');
  if (family === 'uncertainty')
    rules.push('axis labels and units', 'distinguish observed from modeled');
  if (family === 'waterfall') rules.push('deltas reconcile to final', 'labels bind to bars');
  if (family === 'causal')
    rules.push('directed edges', 'edge polarity is plus or minus', 'loops are R or B');
  if (family === 'sankey')
    rules.push('band width encodes quantity', 'flow conserves at intermediate nodes');
  if (family === 'gantt') rules.push('visible dependencies', 'confidence is encoded');
  if (family === 'equation')
    rules.push('calculation evaluates the expression AST', 'symbols map to evidence');
  if (['frontier', 'model-compare', 'harness-compare'].includes(family))
    rules.push('observed and pilot cohorts stay separate', 'missing metrics remain missing');
  if (id === 'pdf-evidence-region')
    rules.push('source MIME must be application/pdf', 'page and region are digest-bound');
  return rules;
}

function specKindFor(artifact) {
  if (artifact.family === 'waterfall') return 'waterfall';
  if (artifact.family === 'sankey') return 'sankey';
  if (artifact.family === 'causal') return 'causal-loop';
  if (['architecture', 'sequence', 'decision-tree', 'lineage'].includes(artifact.family))
    return 'graph';
  if (artifact.family === 'timeline') return 'timeline';
  if (artifact.family === 'gantt') return 'gantt';
  if (['screenshot', 'product-compare', 'pdf'].includes(artifact.family)) return 'evidence-media';
  if (['scrolly', 'chart-states', 'interaction'].includes(artifact.family)) return 'motion';
  if (artifact.family === 'spatial') return 'spatial-scene';
  if (['scatter', 'frontier', 'model-compare', 'harness-compare'].includes(artifact.family))
    return 'comparison';
  if (artifact.family === 'equation') return 'equation';
  if (artifact.family === 'code') return 'runtime-proof';
  if (artifact.family === 'trace') return 'trace';
  if (artifact.family === 'risk') return 'risk-matrix';
  if (['line', 'uncertainty', 'kpi', 'table', 'dashboard'].includes(artifact.family))
    return 'chart';
  return 'generic';
}

function specPayloadFor(artifact) {
  if (artifact.family === 'uncertainty')
    return {
      unit: 'quality points',
      xAxis: { labels: ['Q1 observed', 'Q2 observed', 'Q3 modeled', 'Q4 modeled', 'Q5 modeled'] },
      yAxis: { min: 8, max: 14 },
      series: [
        { id: 'low', values: [9.0, 9.4, 9.6, 9.2, 9.0], status: 'modeled-bound' },
        { id: 'base', values: [9.0, 9.4, 10.2, 10.8, 11.4], status: 'observed-then-modeled' },
        { id: 'high', values: [9.0, 9.4, 10.8, 12.0, 13.8], status: 'modeled-bound' },
      ],
    };
  if (artifact.family === 'waterfall')
    return {
      unit: 'quality points',
      baseline: 62,
      deltas: [
        { label: 'Plan', value: 8 },
        { label: 'Tools', value: 7 },
        { label: 'Repair', value: 5 },
        { label: 'Deck CI', value: 4 },
      ],
      final: 86,
      tolerance: 0,
    };
  if (artifact.family === 'sankey')
    return {
      unit: 'evidence units',
      tolerance: 0,
      nodes: [
        { id: 'source-a', label: 'Source A', layer: 'source' },
        { id: 'source-b', label: 'Source B', layer: 'source' },
        { id: 'source-c', label: 'Source C', layer: 'source' },
        { id: 'claims', label: 'Claims', layer: 'middle' },
        { id: 'rejections', label: 'Rejections', layer: 'middle' },
        { id: 'charts', label: 'Charts', layer: 'sink' },
        { id: 'diagrams', label: 'Diagrams', layer: 'sink' },
        { id: 'proof', label: 'Proof', layer: 'sink' },
      ],
      links: [
        { source: 'source-a', target: 'claims', value: 26 },
        { source: 'source-b', target: 'claims', value: 38 },
        { source: 'source-c', target: 'claims', value: 22 },
        { source: 'source-c', target: 'rejections', value: 12 },
        { source: 'source-a', target: 'rejections', value: 10 },
        { source: 'claims', target: 'charts', value: 26 },
        { source: 'claims', target: 'diagrams', value: 38 },
        { source: 'claims', target: 'proof', value: 22 },
        { source: 'rejections', target: 'diagrams', value: 10 },
        { source: 'rejections', target: 'proof', value: 12 },
      ],
    };
  if (artifact.family === 'causal')
    return {
      nodes: ['receipt', 'trust', 'reuse', 'signal', 'complexity'].map((id) => ({ id })),
      edges: [
        { id: 'e1', from: 'receipt', to: 'trust', directed: true, polarity: '+' },
        { id: 'e2', from: 'trust', to: 'reuse', directed: true, polarity: '+' },
        { id: 'e3', from: 'reuse', to: 'signal', directed: true, polarity: '+' },
        { id: 'e4', from: 'signal', to: 'receipt', directed: true, polarity: '+' },
        { id: 'e5', from: 'reuse', to: 'complexity', directed: true, polarity: '+' },
        { id: 'e6', from: 'complexity', to: 'trust', directed: true, polarity: '-' },
      ],
      loops: [
        { id: 'R1', type: 'reinforcing', edgeIds: ['e1', 'e2', 'e3', 'e4'] },
        { id: 'B1', type: 'balancing', edgeIds: ['e2', 'e5', 'e6'] },
      ],
    };
  if (artifact.family === 'gantt')
    return {
      unit: 'week',
      tasks: [
        { id: 'media', start: 1, end: 2, confidence: 0.95, dependsOn: [] },
        { id: 'data', start: 2, end: 3, confidence: 0.9, dependsOn: [] },
        { id: 'motion', start: 3, end: 5, confidence: 0.72, dependsOn: ['media', 'data'] },
        { id: 'domains', start: 3, end: 5, confidence: 0.88, dependsOn: ['data'] },
        { id: 'review', start: 6, end: 6, confidence: 0.6, dependsOn: ['motion', 'domains'] },
      ],
    };
  if (artifact.family === 'equation') {
    const expression = {
      op: 'divide',
      args: [
        { op: 'value', name: 'Q' },
        {
          op: 'add',
          args: [
            { op: 'value', name: 'one' },
            {
              op: 'multiply',
              args: [
                { op: 'value', name: 'alpha' },
                { op: 'value', name: 'C' },
              ],
            },
            {
              op: 'multiply',
              args: [
                { op: 'value', name: 'beta' },
                { op: 'value', name: 'L' },
              ],
            },
          ],
        },
      ],
    };
    return {
      expression,
      values: { Q: 0.75, one: 1, alpha: 0.4, C: 0.038, beta: 0.1, L: 1.04 },
      result: 0.6701,
      tolerance: 0.0001,
      rounding: 3,
    };
  }
  if (artifact.family === 'pdf')
    return {
      mimeType: 'application/pdf',
      digest: 'sha256:78473e2c158b02b34bac658288d893644307a63e96a83f736e8d12146265709c',
      claimId: `${artifact.id}:claim:1`,
      page: 1,
      region: { x: 0.08, y: 0.42, width: 0.84, height: 0.18 },
      captureVersion: 'artifact-atlas-v2',
    };
  if (artifact.family === 'screenshot')
    return {
      mimeType: 'image/png',
      digest: 'nodeslide-artifact-lab-v1-gallery-capture',
      claimId: `${artifact.id}:claim:1`,
      captureVersion: 'artifact-atlas-v1',
      callouts: 3,
    };
  if (artifact.family === 'code')
    return { sampleSize: 0, unit: 'ms', receiptDigest: '', status: 'illustrative-not-measured' };
  if (artifact.family === 'trace')
    return { traceId: 'illustrative', spans: [], status: 'illustrative-not-observed' };
  if (artifact.family === 'risk')
    return {
      likelihoodAxis: { low: 'rare', high: 'likely' },
      impactAxis: { low: 'minor', high: 'critical' },
      risks: [
        { id: 'pipeline', likelihood: 4, impact: 5 },
        { id: 'capacity', likelihood: 3, impact: 4 },
        { id: 'retention', likelihood: 2, impact: 5 },
      ],
    };
  if (artifact.family === 'spatial')
    return {
      viewports: [
        { id: 'whole', level: 1 },
        { id: 'subsystem', level: 2 },
        { id: 'node', level: 3, selectedNodeId: 'validator' },
        {
          id: 'source',
          level: 4,
          selectedNodeId: 'validator',
          sourceIds: artifact.evidence.map((source) => source.sourceId),
        },
      ],
    };
  if (['scrolly', 'chart-states', 'interaction'].includes(artifact.family))
    return {
      states: Array.from({ length: artifact.family === 'interaction' ? 3 : 5 }, (_, index) => ({
        id: `state-${index + 1}`,
      })),
      transition: artifact.family === 'scrolly' ? 'scrub' : 'step',
      staticFallbackStateId: artifact.family === 'interaction' ? 'state-3' : 'state-5',
    };
  if (['frontier', 'model-compare', 'harness-compare', 'scatter'].includes(artifact.family))
    return comparisonPayload(artifact.family);
  if (artifact.family === 'timeline')
    return {
      unit: 'day',
      events: [1, 3, 6, 9, 11].map((day, index) => ({
        id: `event-${index + 1}`,
        start: day,
        end: day,
      })),
    };
  if (['architecture', 'sequence', 'decision-tree', 'lineage'].includes(artifact.family))
    return {
      directed: true,
      nodes: [{ id: 'source' }, { id: 'output' }],
      edges: [{ id: 'edge-1', from: 'source', to: 'output', directed: true }],
    };
  if (['line', 'kpi', 'table', 'dashboard'].includes(artifact.family))
    return {
      unit: 'score',
      xAxis: { labels: ['A', 'B'] },
      yAxis: { min: 0, max: 100 },
      series: [{ id: 'series-1', values: [62, 86] }],
    };
  if (artifact.family === 'product-compare')
    return {
      mimeType: 'image/png',
      digest: 'nodeslide-product-before-after',
      claimId: `${artifact.id}:claim:1`,
      captureVersion: 'artifact-atlas-v2',
    };
  return { label: artifact.title };
}

function comparisonPayload(family) {
  if (family === 'harness-compare')
    return {
      comparisonType: 'coverage-only',
      metrics: [{ id: 'artifactCoverage', unit: 'artifact count' }],
      cohorts: [
        { id: 'v1', status: 'observed', plotted: true, values: { artifactCoverage: 12 } },
        { id: 'v2', status: 'observed', plotted: true, values: { artifactCoverage: 38 } },
      ],
    };
  const metrics = [
    { id: 'quality', unit: 'eligible fraction' },
    { id: 'cost', unit: 'USD per candidate' },
    { id: 'latency', unit: 'seconds' },
  ];
  const cohorts = [
    {
      id: 'claude',
      status: 'observed',
      plotted: true,
      values: { quality: 1, cost: 0.00862, latency: 8.193 },
    },
    {
      id: 'kimi',
      status: 'observed',
      plotted: true,
      values: { quality: 23 / 24, cost: 0.001303, latency: 17.617 },
    },
    {
      id: 'gemma',
      status: 'observed',
      plotted: true,
      values: { quality: 23 / 24, cost: 0, latency: 17.271 },
    },
    { id: 'nemotron', status: 'pilot', plotted: false, values: {} },
    { id: 'gpt-oss', status: 'pilot', plotted: false, values: {} },
    { id: 'ensemble', status: 'not-run', plotted: false, values: {} },
  ];
  return { comparisonType: 'observed-routes', metrics, cohorts };
}
