import { CheckCircle2, FlaskConical, Images, Scale, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useModalDialog } from './useModalDialog';

export const ARTIFACT_LAB_ENTRIES = [
  ['hero-thesis', 'Hero thesis', 'One evidence-bounded idea with a memorable visual anchor.'],
  ['kpi-strip', 'KPI strip', 'Comparable operating metrics with context, not dashboard confetti.'],
  [
    'multi-series-trend',
    'Multi-series trend',
    'An annotated divergence chart that avoids invented causes.',
  ],
  [
    'uncertainty-range',
    'Uncertainty range',
    'A forecast band that makes confidence and assumptions visible.',
  ],
  [
    'system-architecture',
    'Architecture diagram',
    'Layered boundaries with inspectable ownership and handoffs.',
  ],
  [
    'request-sequence',
    'Request sequence',
    'Ordering, review custody, and failure boundaries in one flow.',
  ],
  [
    'research-timeline',
    'Research timeline',
    'Milestones from question to evidence-backed decision.',
  ],
  [
    'screenshot-callouts',
    'Screenshot callouts',
    'Product evidence with explicit annotation and replacement state.',
  ],
  [
    'claim-source-lineage',
    'Claim-source lineage',
    'Trace a claim through source, validation, and slide usage.',
  ],
  [
    'quality-cost-equation',
    'Quality / cost equation',
    'Editable math tied to measured experiment inputs.',
  ],
  [
    'code-runtime-proof',
    'Code + runtime proof',
    'A small API contract paired with measured behavior.',
  ],
  ['risk-matrix', 'Risk matrix', 'Likelihood and impact positioned for an operating decision.'],
] as const;

const modelEvidence = [
  ['Kimi K3', 'Live', 'moonshotai-kimi-k3', 'evidence-editorial'],
  ['Claude Sonnet 5', 'Live', 'anthropic-claude-sonnet-5', 'evidence-editorial'],
  ['Gemma 4 26B Free', 'Free', 'google-gemma-4-26b-a4b-it-free', 'evidence-editorial'],
  ['Deterministic baseline', 'Control', 'nodeslide-artifact-builder-v1', 'deterministic-baseline'],
] as const;

type LabMode = 'gallery' | 'models' | 'harness';
type CompareView = 'rendered' | 'operations' | 'economics' | 'pptx';
type CatalogCandidate = {
  candidateId: string;
  model: string;
  status: 'eligible' | 'failed';
  evaluation: {
    generationMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costMicroUsd: number | null;
  };
  operations: Array<{ operationId: string; label: string; sourceId: string }>;
};
type CatalogEntry = {
  id: string;
  number: number;
  chapter: string;
  title: string;
  description: string;
  preview: string;
  recipe: {
    recipeId: string;
    requiredInputs: string[];
    supportedTools: string[];
  };
  behavior: {
    web: string;
    powerpoint: string;
    pdf: string;
    reducedMotion: string;
  };
  accessibility: {
    altText: string;
    highContrast: boolean;
    reducedMotion: boolean;
  };
  receipt: {
    harnessVersion: string;
    model: string;
    generationLatencyMs: number;
    costMicroUsd: number;
    repairCount: number;
    humanPreferenceResult: string;
    knownFidelityDifferences: string;
    deckCi: {
      evidencePassed: boolean;
      browserRender: boolean;
      overlapCheck: string;
    };
  };
};
type ModelRoute = {
  model: string;
  status: string;
  eligible?: number;
  candidates?: number;
  averageGenerationMs?: number;
  costMicroUsd?: number;
};
type HarnessCompare = {
  comparisonBasis: string;
  previous: {
    harness: string;
    artifacts: number;
    designDirections: number;
    recipes: number;
  };
  current: {
    harness: string;
    artifacts: number;
    designLanguages: number;
    motionTemplates: number;
    recipes: number;
    domainPacks: number;
  };
  humanPreference: string;
};

const fallbackEntries: CatalogEntry[] = ARTIFACT_LAB_ENTRIES.map(
  ([id, title, description], index) => ({
    id,
    number: index + 1,
    chapter: 'artifact-baseline',
    title,
    description,
    preview: `artifact-atlas/${id}.png`,
    recipe: {
      recipeId: `nodeslide.recipe.${id}.v1`,
      requiredInputs: [],
      supportedTools: [],
    },
    behavior: {
      web: 'Static evidence preview.',
      powerpoint: 'Editable final state.',
      pdf: 'Static final state.',
      reducedMotion: 'Static final state.',
    },
    accessibility: {
      altText: `${title} benchmark preview`,
      highContrast: true,
      reducedMotion: true,
    },
    receipt: {
      harnessVersion: 'artifact-atlas-v1',
      model: 'nodeslide-artifact-builder-v1',
      generationLatencyMs: 0,
      costMicroUsd: 0,
      repairCount: 0,
      humanPreferenceResult: 'pending',
      knownFidelityDifferences: 'Catalog V2 receipt loads with the deployed Atlas.',
      deckCi: {
        evidencePassed: true,
        browserRender: true,
        overlapCheck: 'v1-baseline',
      },
    },
  }),
);

export function ArtifactLabDialog({
  open,
  onClose,
  onUsePattern,
}: {
  open: boolean;
  onClose: () => void;
  onUsePattern: (prompt: string) => void;
}) {
  const [mode, setMode] = useState<LabMode>('gallery');
  const [comparisonFixture, setComparisonFixture] = useState('hero-thesis');
  const [compareView, setCompareView] = useState<CompareView>('rendered');
  const [catalogCandidates, setCatalogCandidates] = useState<CatalogCandidate[]>([]);
  const [catalogEntries, setCatalogEntries] = useState<CatalogEntry[]>(fallbackEntries);
  const [modelRoutes, setModelRoutes] = useState<ModelRoute[]>([]);
  const [harnessCompare, setHarnessCompare] = useState<HarnessCompare | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open,
    onClose,
    initialFocusRef: closeRef,
  });
  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch('/artifact-atlas-v2/catalog.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('catalog'))))
      .then((catalog) => {
        if (!active) return;
        if (Array.isArray(catalog.entries)) setCatalogEntries(catalog.entries);
        if (Array.isArray(catalog.modelCompare?.routes))
          setModelRoutes(catalog.modelCompare.routes);
        if (catalog.harnessCompare) setHarnessCompare(catalog.harnessCompare);
      })
      .catch(() => undefined);
    void fetch('/artifact-atlas/catalog.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('catalog'))))
      .then((catalog) => {
        if (active && Array.isArray(catalog.candidates)) setCatalogCandidates(catalog.candidates);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="ns-artifact-lab-dialog"
      aria-labelledby="artifact-lab-title"
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
    >
      <section className="ns-artifact-lab-shell">
        <header>
          <div>
            <span className="ns-eyebrow">Deck Gym · Artifact Atlas V2</span>
            <h2 id="artifact-lab-title">Artifact Lab</h2>
            <p>Browse 38 evidence-bound recipes, compare routes, and inspect export receipts.</p>
          </div>
          <button ref={closeRef} type="button" aria-label="Close Artifact Lab" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <nav aria-label="Artifact Lab modes">
          <button type="button" data-active={mode === 'gallery'} onClick={() => setMode('gallery')}>
            <Images size={15} /> Artifact Gallery
          </button>
          <button type="button" data-active={mode === 'models'} onClick={() => setMode('models')}>
            <Scale size={15} /> Model Compare
          </button>
          <button type="button" data-active={mode === 'harness'} onClick={() => setMode('harness')}>
            <FlaskConical size={15} /> Harness Compare
          </button>
        </nav>

        {mode === 'gallery' ? (
          <div className="ns-artifact-gallery" data-testid="artifact-gallery">
            {catalogEntries.map((entry) => (
              <article key={entry.id}>
                <div className="ns-artifact-preview">
                  <img src={`/${entry.preview}`} alt={entry.accessibility.altText} />
                  <span>
                    <CheckCircle2 size={12} /> Evidence-eligible
                  </span>
                </div>
                <div>
                  <small>
                    {String(entry.number).padStart(2, '0')} · {entry.chapter.replaceAll('-', ' ')}
                  </small>
                  <h3>{entry.title}</h3>
                  <p>{entry.description}</p>
                  <div className="ns-artifact-actions">
                    <button type="button" onClick={() => useArtifact(entry, 'slide', onUsePattern)}>
                      Use slide
                    </button>
                    <button
                      type="button"
                      onClick={() => useArtifact(entry, 'recipe', onUsePattern)}
                    >
                      Use recipe
                    </button>
                    <button type="button" onClick={() => useArtifact(entry, 'data', onUsePattern)}>
                      Generate with my data
                    </button>
                    <button
                      type="button"
                      onClick={() => useArtifact(entry, 'variants', onUsePattern)}
                    >
                      3 variants
                    </button>
                  </div>
                  <details className="ns-artifact-receipt">
                    <summary>Source JSON · trace · export receipt</summary>
                    <dl>
                      <div>
                        <dt>Recipe</dt>
                        <dd>{entry.recipe.recipeId}</dd>
                      </div>
                      <div>
                        <dt>Harness</dt>
                        <dd>{entry.receipt.harnessVersion}</dd>
                      </div>
                      <div>
                        <dt>Builder</dt>
                        <dd>{entry.receipt.model}</dd>
                      </div>
                      <div>
                        <dt>Deck CI</dt>
                        <dd>{entry.receipt.deckCi.overlapCheck}</dd>
                      </div>
                      <div>
                        <dt>PPTX</dt>
                        <dd>{entry.behavior.powerpoint}</dd>
                      </div>
                      <div>
                        <dt>Human preference</dt>
                        <dd>{entry.receipt.humanPreferenceResult}</dd>
                      </div>
                    </dl>
                    <p>{entry.receipt.knownFidelityDifferences}</p>
                    <a href="/artifact-atlas-v2/catalog.json" download>
                      Download source JSON
                    </a>
                  </details>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {mode === 'models' ? (
          <div className="ns-artifact-model-compare" data-testid="artifact-model-compare">
            <div className="ns-artifact-callout">
              <strong>38 canonical recipes · 7 routed model/control paths</strong>
              <span>
                Paid, free-router, deterministic, and ensemble status from observed receipts only
              </span>
            </div>
            <label className="ns-artifact-fixture-picker">
              <span>Compare the same artifact</span>
              <select
                aria-label="Comparison artifact"
                value={comparisonFixture}
                onChange={(event) => setComparisonFixture(event.target.value)}
              >
                {catalogEntries
                  .filter((entry) => ARTIFACT_LAB_ENTRIES.some(([id]) => id === entry.id))
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
              </select>
            </label>
            <div className="ns-artifact-view-switch" aria-label="Comparison evidence">
              {(['rendered', 'pptx', 'operations', 'economics'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  data-active={compareView === view}
                  onClick={() => setCompareView(view)}
                >
                  {view === 'pptx' ? 'PowerPoint' : view}
                </button>
              ))}
            </div>
            <div className="ns-artifact-model-grid">
              {modelEvidence.map(([model, route, slug, direction]) => (
                <article key={model}>
                  <CandidateEvidence
                    candidateId={`${comparisonFixture}__${direction}__${slug}`}
                    model={model}
                    view={compareView}
                    catalogCandidates={catalogCandidates}
                  />
                  <span>{route}</span>
                  <h3>{model}</h3>
                  <p>Same brief · same evidence · same artifact contract</p>
                  <small>Rendered result · browser evidence</small>
                </article>
              ))}
            </div>
            <div className="ns-artifact-route-ledger" aria-label="Observed route ledger">
              {modelRoutes.map((route) => (
                <article key={route.model}>
                  <strong>{route.model}</strong>
                  <span>{route.status.replaceAll('-', ' ')}</span>
                  <small>
                    {route.eligible === undefined
                      ? 'Pilot / pending route'
                      : `${route.eligible}/${route.candidates} eligible`}
                    {route.costMicroUsd === 0 ? ' · free' : ''}
                  </small>
                </article>
              ))}
            </div>
            <p className="ns-artifact-caveat">
              Capability cards report observed execution only. Rankings remain provisional until a
              human completes model-blind pairwise preference review.
            </p>
          </div>
        ) : null}

        {mode === 'harness' ? (
          <div className="ns-artifact-harness-compare" data-testid="artifact-harness-compare">
            <article>
              <span>Current</span>
              <strong>{harnessCompare?.current.harness ?? 'Artifact Atlas V2'}</strong>
              <p>
                {harnessCompare
                  ? `${harnessCompare.current.artifacts} artifacts · ${harnessCompare.current.designLanguages} design languages · ${harnessCompare.current.motionTemplates} motion contracts · ${harnessCompare.current.recipes} recipes · ${harnessCompare.current.domainPacks} domain packs.`
                  : '38 recipes, source-bound operations, browser/PPTX parity, and export critics.'}
              </p>
            </article>
            <div aria-hidden="true">→</div>
            <article>
              <span>Prior baseline</span>
              <strong>{harnessCompare?.previous.harness ?? 'Artifact Atlas V1'}</strong>
              <p>
                {harnessCompare
                  ? `${harnessCompare.previous.artifacts} artifacts · ${harnessCompare.previous.designDirections} directions · ${harnessCompare.previous.recipes} reusable recipes. Human preference: ${harnessCompare.humanPreference}.`
                  : '12 fixtures and two visual directions. Paired human preference remains pending.'}
              </p>
            </article>
          </div>
        ) : null}
      </section>
    </dialog>
  );
}

function CandidateEvidence({
  candidateId,
  model,
  view,
  catalogCandidates,
}: {
  candidateId: string;
  model: string;
  view: CompareView;
  catalogCandidates: CatalogCandidate[];
}) {
  const evidence = catalogCandidates.find((candidate) => candidate.candidateId === candidateId);
  if (view === 'rendered' || view === 'pptx') {
    const suffix = view === 'pptx' ? '-pptx' : '';
    return (
      <div className="ns-artifact-candidate-preview">
        <img
          src={`/artifact-atlas/candidates/${candidateId}${suffix}.png`}
          alt={`${(candidateId.split('__').at(0) ?? candidateId).replaceAll('-', ' ')} ${view} result from ${model}`}
        />
        {evidence ? <span data-status={evidence.status}>{evidence.status}</span> : null}
      </div>
    );
  }
  if (view === 'operations') {
    return (
      <div className="ns-artifact-operation-list">
        {(evidence?.operations ?? []).map((operation) => (
          <div key={operation.operationId}>
            <strong>{operation.label}</strong>
            <small>{operation.sourceId}</small>
          </div>
        ))}
        {!evidence ? <p>Receipt loads with the deployed Atlas catalog.</p> : null}
      </div>
    );
  }
  return (
    <div className="ns-artifact-economics">
      <strong>{formatDuration(evidence?.evaluation.generationMs)}</strong>
      <span>generation latency</span>
      <strong>{formatCost(evidence?.evaluation.costMicroUsd)}</strong>
      <span>reported model cost</span>
      <small>
        {evidence
          ? `${evidence.evaluation.inputTokens ?? 0} in · ${evidence.evaluation.outputTokens ?? 0} out`
          : 'Receipt loads with the Atlas catalog.'}
      </small>
    </div>
  );
}

function useArtifact(
  entry: CatalogEntry,
  action: 'slide' | 'recipe' | 'data' | 'variants',
  onUsePattern: (prompt: string) => void,
) {
  const shared = `Use the Artifact Atlas V2 recipe ${entry.recipe.recipeId} for a ${entry.title.toLowerCase()}. Preserve source lineage, editability, high contrast, and the declared PowerPoint fallback.`;
  const prompts = {
    slide: `${shared} Add one slide where this pattern materially strengthens the argument.`,
    recipe: `${shared} Apply its inputs (${entry.recipe.requiredInputs.join(', ') || 'topic evidence'}) and tool contract (${entry.recipe.supportedTools.join(', ') || 'native slide primitives'}).`,
    data: `${shared} Ask me for the minimum required data, then generate the artifact with my values without inventing missing evidence.`,
    variants: `${shared} Generate three meaningfully different visual directions while keeping the same claims and evidence.`,
  };
  onUsePattern(prompts[action]);
}

function formatDuration(value: number | null | undefined) {
  return Number.isFinite(value) ? `${(Number(value) / 1000).toFixed(1)}s` : '—';
}

function formatCost(value: number | null | undefined) {
  return Number.isFinite(value) ? `$${(Number(value) / 1_000_000).toFixed(4)}` : '—';
}
