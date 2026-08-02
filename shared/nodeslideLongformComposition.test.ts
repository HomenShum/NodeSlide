import { describe, expect, it } from 'vitest';
import { buildBriefNodeSlide } from '../convex/lib/nodeslideSeed';
import { validateNodeSlideSnapshot } from '../convex/lib/nodeslideValidation';

const brief = {
  prompt:
    'Create exactly 10 slides for a source-grounded transaction approval deck for an investment committee.',
  audience: 'Transaction approval committee',
  purpose: 'decide whether to approve the transaction',
  successCriteria: ['Preserve exact terms', 'Expose downside', 'Keep claims source-grounded'],
};

const provenance = {
  truthState: 'derived' as const,
  rationale: 'Bounded by the supplied transaction brief.',
  sourceRefs: ['brief:prompt'],
};

function slide(index: number, artifactSpec?: Record<string, unknown>) {
  return {
    title: `Committee page ${index}`,
    section: index < 4 ? 'Decision' : index < 8 ? 'Evidence' : 'Recommendation',
    headline: `Decision claim ${index}`,
    body: 'Separate reported evidence, attributed claims, derived analysis, and open diligence.',
    bullets: ['Observed evidence', 'Decision implication', 'Open diligence owner'],
    ...(artifactSpec ? { artifactSpec } : {}),
  };
}

function artifact(id: string, kind: string, payload: Record<string, unknown>) {
  return {
    schemaVersion: 'nodeslide.artifact-spec/v1',
    id,
    kind,
    narrativeJob: `Make ${kind} evidence inspectable and editable.`,
    claimIds: [`claim-${id}`],
    sourceIds: ['brief:prompt'],
    provenance,
    payload,
  };
}

describe('long-form artifact composition', () => {
  it('keeps a four-stage approval chain on one left-to-right row', () => {
    const built = buildBriefNodeSlide({
      deckId: 'four-stage-approval-chain',
      projectId: 'four-stage-approval-chain',
      title: 'Four-stage approval chain',
      brief: { ...brief, prompt: 'Create exactly 4 slides for a backend approval chain.' },
      themeId: 'quiet-precision',
      rawSpec: {
        title: 'Four-stage approval chain',
        narrative: ['Brief', 'Approve', 'Execute', 'Prove'],
        slides: Array.from({ length: 4 }, (_, index) =>
          index === 1
            ? {
                ...slide(index + 1),
                diagram: {
                  kind: 'process' as const,
                  direction: 'horizontal' as const,
                  nodes: [
                    'Brief → proposal',
                    'Approval',
                    'Hash-bound plan',
                    'Render → receipt',
                  ].map((label, nodeIndex) => ({ id: `node-${nodeIndex + 1}`, label })),
                  edges: [1, 2, 3].map((edgeIndex) => ({
                    from: `node-${edgeIndex}`,
                    to: `node-${edgeIndex + 1}`,
                  })),
                },
              }
            : slide(index + 1),
        ),
      },
      now: 1_700_000_000_000,
    });
    const rendered = built.snapshot.slides[1];
    const nodeBoxes = built.snapshot.elements
      .filter((element) => element.slideId === rendered?.id && element.role?.startsWith('diagram_'))
      .filter((element) => element.kind === 'shape')
      .map((element) => element.bbox);
    expect(nodeBoxes).toHaveLength(4);
    expect(new Set(nodeBoxes.map((bbox) => bbox.y.toFixed(4))).size).toBe(1);
    expect(nodeBoxes.map((bbox) => bbox.x)).toEqual([...nodeBoxes.map((bbox) => bbox.x)].sort());
  });

  it('keeps a six-stage approved media workflow clear of its explanatory copy', () => {
    const now = 1_700_000_000_000;
    const stages = ['Brief', 'Typed proposal', 'Approval', 'Plan hash', 'Render', 'Receipt'];
    const built = buildBriefNodeSlide({
      deckId: 'approved-media-workflow',
      projectId: 'approved-media-workflow',
      title: 'Approved media workflow',
      brief: {
        ...brief,
        prompt: 'Create exactly 6 slides explaining an approved deterministic media workflow.',
      },
      themeId: 'quiet-precision',
      rawSpec: {
        title: 'Approved media workflow',
        narrative: ['Orient', 'Plan', 'Approve', 'Execute', 'Prove', 'Close'],
        slides: Array.from({ length: 6 }, (_, index) =>
          index === 2
            ? {
                ...slide(index + 1),
                headline: 'Approval binds the plan before media code runs.',
                body: 'No shell commands. No arbitrary renderer graph.',
                diagram: {
                  kind: 'process' as const,
                  direction: 'horizontal' as const,
                  nodes: stages.map((label, nodeIndex) => ({
                    id: `stage-${nodeIndex + 1}`,
                    label,
                    kind: nodeIndex === 2 ? ('decision' as const) : ('step' as const),
                  })),
                  edges: stages.slice(1).map((_, edgeIndex) => ({
                    from: `stage-${edgeIndex + 1}`,
                    to: `stage-${edgeIndex + 2}`,
                  })),
                },
              }
            : slide(index + 1),
        ),
      },
      now,
    });

    const processSlide = built.snapshot.slides[2];
    expect(processSlide?.notes).toContain('Composition grammar: process-canvas');
    const processIssueCodes = validateNodeSlideSnapshot(built.snapshot, now)
      .issues.filter((issue) => issue.slideId === processSlide?.id)
      .map((issue) => issue.code);
    expect(processIssueCodes).not.toContain('collision');
    expect(processIssueCodes).not.toContain('overflow');
  });

  it('keeps compiled artifacts inside executable grammars instead of collapsing to the legacy scaffold', () => {
    const built = buildBriefNodeSlide({
      deckId: 'longform-artifact-rhythm',
      projectId: 'longform-artifact-rhythm',
      title: 'Transaction approval rhythm',
      brief,
      themeId: 'quiet-precision',
      rawSpec: {
        title: 'Transaction approval rhythm',
        narrative: ['Orient', 'Reconcile', 'Stress', 'Decide'],
        slides: [
          slide(1),
          slide(
            2,
            artifact('revenue', 'chart', {
              unit: 'USD millions',
              xAxis: { labels: ['2023A', '2024A', '2025E'] },
              yAxis: { min: 0, max: 400 },
              series: [{ id: 'sales', values: [322, 314, 260] }],
            }),
          ),
          slide(
            3,
            artifact('decision-path', 'graph', {
              directed: true,
              graphKind: 'process',
              direction: 'horizontal',
              nodes: [
                { id: 'evidence', label: 'Evidence', kind: 'system' },
                { id: 'condition', label: 'Condition', kind: 'decision' },
                { id: 'approval', label: 'Approval', kind: 'milestone' },
              ],
              edges: [
                { id: 'e1', from: 'evidence', to: 'condition', directed: true },
                { id: 'e2', from: 'condition', to: 'approval', directed: true },
              ],
            }),
          ),
          slide(
            4,
            artifact('risk-field', 'risk-matrix', {
              likelihoodAxis: { low: 'rare', high: 'likely' },
              impactAxis: { low: 'minor', high: 'critical' },
              risks: [
                { id: 'china', label: 'China recovery', likelihood: 4, impact: 5 },
                { id: 'forecast', label: 'Forecast credibility', likelihood: 3, impact: 4 },
                { id: 'process', label: 'Process challenge', likelihood: 2, impact: 4 },
              ],
            }),
          ),
          slide(
            5,
            artifact('valuation', 'comparison', {
              metrics: [{ id: 'value', unit: 'USD/share' }],
              cohorts: [
                { id: 'comps', status: 'observed', plotted: true, values: { value: 23.8 } },
                { id: 'offer', status: 'observed', plotted: true, values: { value: 28 } },
                { id: 'dcf', status: 'observed', plotted: true, values: { value: 37.5 } },
              ],
            }),
          ),
          {
            ...slide(6),
            section: 'Transition / From evidence to conditions',
            headline: 'The decision now turns from evidence to enforceable conditions.',
          },
          {
            ...slide(7),
            headline: 'Operating leverage and losses make the downside visible.',
          },
          slide(
            8,
            artifact('closing-path', 'graph', {
              directed: true,
              graphKind: 'process',
              direction: 'vertical',
              nodes: [
                { id: 'approve', label: 'Approve', kind: 'decision' },
                { id: 'conditions', label: 'Conditions', kind: 'step' },
                { id: 'close', label: 'Close', kind: 'milestone' },
              ],
              edges: [
                { id: 'e1', from: 'approve', to: 'conditions', directed: true },
                { id: 'e2', from: 'conditions', to: 'close', directed: true },
              ],
            }),
          ),
          {
            ...slide(9),
            section: 'Recommendation / Conditions',
            headline: 'Approval remains conditional on named owners and dated evidence.',
          },
          { ...slide(10), metric: '$28', metricLabel: 'cash consideration per share' },
        ],
      },
      now: 1_700_000_000_000,
    });

    const artifactSlides = built.spec.slides
      .map((planned, index) => ({ planned, rendered: built.snapshot.slides[index] }))
      .filter(({ planned }) => planned.authoredArtifactSpec);
    expect(artifactSlides.map(({ planned }) => planned.authoredArtifactSpec?.kind)).toEqual([
      'chart',
      'graph',
      'risk-matrix',
      'comparison',
      'graph',
    ]);
    for (const { rendered } of artifactSlides) {
      expect(rendered?.notes).toContain('Composition grammar:');
    }
    const riskSlides = artifactSlides.filter(
      ({ planned }) => planned.authoredArtifactGeometry?.kind === 'risk-matrix',
    );
    expect(riskSlides).toHaveLength(1);
    for (const { rendered } of riskSlides) {
      expect(rendered?.notes).toContain('Composition grammar: risk-field');
      const roles = built.snapshot.elements
        .filter((element) => element.slideId === rendered?.id)
        .map((element) => element.role);
      expect(roles).toContain('artifact_risk_marker');
      expect(roles).not.toContain('decoration');
    }
    expect(built.snapshot.slides[5]?.notes).toContain('Composition grammar: sparse-transition');
    expect(built.snapshot.slides[6]?.notes).toMatch(
      /Composition grammar: (?:risk-escalation|tension-contrast-field)/u,
    );
    const closingRoles = built.snapshot.elements
      .filter((element) => element.slideId === built.snapshot.slides[9]?.id)
      .map((element) => element.role);
    expect(closingRoles).toContain('artifact_decision_gate');
  });
});
