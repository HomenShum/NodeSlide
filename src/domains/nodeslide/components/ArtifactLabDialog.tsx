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
  const closeRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open,
    onClose,
    initialFocusRef: closeRef,
  });
  useEffect(() => {
    if (!open) return;
    let active = true;
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
            <span className="ns-eyebrow">Deck Gym · Artifact Atlas v1</span>
            <h2 id="artifact-lab-title">Artifact Lab</h2>
            <p>Compare visual primitives before asking a model to compose a whole deck.</p>
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
            {ARTIFACT_LAB_ENTRIES.map(([id, title, description]) => (
              <article key={id}>
                <div className="ns-artifact-preview">
                  <img src={`/artifact-atlas/${id}.png`} alt={`${title} benchmark preview`} />
                  <span>
                    <CheckCircle2 size={12} /> Evidence-eligible
                  </span>
                </div>
                <div>
                  <small>{id.replaceAll('-', ' ')}</small>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <button
                    type="button"
                    onClick={() =>
                      onUsePattern(
                        `Create a concise presentation that uses a ${title.toLowerCase()} where it strengthens the argument. Keep it editable, evidence-bounded, and visually distinctive.`,
                      )
                    }
                  >
                    Use this pattern
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {mode === 'models' ? (
          <div className="ns-artifact-model-compare" data-testid="artifact-model-compare">
            <div className="ns-artifact-callout">
              <strong>84 / 84 plans generated</strong>
              <span>
                12 fixtures · 3 live models · deterministic control · two visual directions
              </span>
            </div>
            <label className="ns-artifact-fixture-picker">
              <span>Compare the same artifact</span>
              <select
                aria-label="Comparison artifact"
                value={comparisonFixture}
                onChange={(event) => setComparisonFixture(event.target.value)}
              >
                {ARTIFACT_LAB_ENTRIES.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
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
              <strong>Artifact Atlas v1</strong>
              <p>
                Semantic primitives, source-bound operations, browser/PPTX parity, export critics.
              </p>
            </article>
            <div aria-hidden="true">→</div>
            <article data-empty="true">
              <span>Prior comparable receipt</span>
              <strong>Not available</strong>
              <p>
                The first honest paired harness comparison begins when v2 runs the same fixtures.
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

function formatDuration(value: number | null | undefined) {
  return Number.isFinite(value) ? `${(Number(value) / 1000).toFixed(1)}s` : '—';
}

function formatCost(value: number | null | undefined) {
  return Number.isFinite(value) ? `$${(Number(value) / 1_000_000).toFixed(4)}` : '—';
}
