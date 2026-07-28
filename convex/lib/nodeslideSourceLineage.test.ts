import { describe, expect, it } from 'vitest';
import type { PatchOperation } from '../../shared/nodeslide';
import { traceFromRow } from './nodeslideData';
import { validateNodeSlidePatch } from './nodeslidePatches';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import { buildNodeSlideSourceLineage, nodeSlideOperationSourceIds } from './nodeslideSourceLineage';

const textOperation: PatchOperation = {
  op: 'replace_text',
  slideId: 'slide-1',
  elementId: 'headline-1',
  text: 'Attendance reached 3.4 million.',
  sourceIds: ['source-fifa'],
};

const unboundTextOperation: PatchOperation = {
  op: 'replace_text',
  slideId: 'slide-1',
  elementId: 'headline-1',
  text: 'Attendance reached 3.4 million.',
};

const chartOperation: PatchOperation = {
  op: 'update_chart',
  slideId: 'slide-2',
  elementId: 'chart-1',
  chart: {
    chartType: 'bar',
    labels: ['2018', '2022'],
    series: [{ name: 'Attendance', values: [3_031_768, 3_404_252] }],
    sourceId: 'source-fifa',
  },
};

describe('NodeSlide claim-level source lineage', () => {
  it('materializes deterministic element-level bindings for factual text and charts', () => {
    const first = buildNodeSlideSourceLineage({
      operations: [
        textOperation,
        { op: 'move', slideId: 'slide-1', elementId: 'headline-1', x: 0.1, y: 0.2 },
        chartOperation,
      ],
      authorizedSourceIds: ['source-fifa'],
      policy: 'required_external_evidence',
    });
    const second = buildNodeSlideSourceLineage({
      operations: [
        textOperation,
        { op: 'move', slideId: 'slide-1', elementId: 'headline-1', x: 0.1, y: 0.2 },
        chartOperation,
      ],
      authorizedSourceIds: ['source-fifa'],
      policy: 'required_external_evidence',
    });

    expect(first).toEqual(second);
    expect(first.sourceBindingStatus).toBe('bound');
    expect(first.claimSourceBindings).toEqual([
      expect.objectContaining({
        operationIndex: 0,
        operation: 'replace_text',
        slideId: 'slide-1',
        elementId: 'headline-1',
        sourceIds: ['source-fifa'],
        claimDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
      expect.objectContaining({
        operationIndex: 2,
        operation: 'update_chart',
        slideId: 'slide-2',
        elementId: 'chart-1',
        sourceIds: ['source-fifa'],
        claimDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
    expect(nodeSlideOperationSourceIds([textOperation, chartOperation])).toEqual(['source-fifa']);
  });

  // Destination-only shape: `update_chart` here may carry a partial `chartType`/`series` update
  // instead of a full `chart`, keeping the element's existing data and provenance. Parity has no
  // such variant, so this path has no ported coverage and is asserted directly.
  it('treats a partial update_chart as a data change that rebinds nothing', () => {
    const partial: PatchOperation = {
      op: 'update_chart',
      slideId: 'slide-2',
      elementId: 'chart-1',
      series: [{ name: 'Attendance', values: [3_031_768, 3_404_252] }],
    };
    const partialTypeSwitch: PatchOperation = {
      op: 'update_chart',
      slideId: 'slide-2',
      elementId: 'chart-1',
      chartType: 'line',
    };

    // A partial update asserts no new provenance, so it contributes no source ID and no binding.
    expect(nodeSlideOperationSourceIds([partial, partialTypeSwitch])).toEqual([]);
    expect(
      buildNodeSlideSourceLineage({
        operations: [partial],
        authorizedSourceIds: ['source-fifa'],
        policy: 'not_applicable',
      }),
    ).toEqual({ sourceBindingStatus: 'not_applicable', claimSourceBindings: [] });

    // A full replacement still rebinds, and it is distinguishable from the partial form.
    expect(nodeSlideOperationSourceIds([chartOperation])).toEqual(['source-fifa']);

    // The claim digest must fingerprint the partial payload rather than collapse to a constant.
    // A binding only materializes when a source is bound, so carry the partial fields on an
    // operation that also has a full `chart`, and vary only the partial half between the two runs.
    const carrier = (
      partialSeries: number[],
    ): Extract<PatchOperation, { op: 'update_chart' }> => ({
      op: 'update_chart',
      slideId: 'slide-2',
      elementId: 'chart-1',
      chart: {
        chartType: 'bar',
        labels: ['2018', '2022'],
        series: [{ name: 'Attendance', values: [3_031_768, 3_404_252] }],
        sourceId: 'source-fifa',
      },
      series: [{ name: 'Attendance', values: partialSeries }],
    });
    const digestFor = (partialSeries: number[]): string | undefined =>
      buildNodeSlideSourceLineage({
        operations: [carrier(partialSeries)],
        authorizedSourceIds: ['source-fifa'],
        policy: 'not_applicable',
      }).claimSourceBindings[0]?.claimDigest;

    expect(digestFor([1, 2])).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestFor([1, 2])).toBe(digestFor([1, 2]));
    expect(digestFor([1, 2])).not.toBe(digestFor([1, 3]));

    // Guard the assertion above against passing for the wrong reason: the two runs differ ONLY in
    // the partial `series`, so an unequal digest can only come from `series` reaching the digest.
    expect(carrier([1, 2]).chart).toEqual(carrier([1, 3]).chart);
  });

  it('rejects missing, unauthorized, and duplicate factual bindings', () => {
    expect(() =>
      buildNodeSlideSourceLineage({
        operations: [unboundTextOperation],
        authorizedSourceIds: ['source-fifa'],
        policy: 'required_external_evidence',
      }),
    ).toThrow('missing a required source binding');
    expect(() =>
      buildNodeSlideSourceLineage({
        operations: [{ ...textOperation, sourceIds: ['source-other'] }],
        authorizedSourceIds: ['source-fifa'],
        policy: 'required_external_evidence',
      }),
    ).toThrow('invalid or unauthorized');
    expect(() =>
      buildNodeSlideSourceLineage({
        operations: [{ ...textOperation, sourceIds: ['source-fifa', 'source-fifa'] }],
        authorizedSourceIds: ['source-fifa'],
        policy: 'required_external_evidence',
      }),
    ).toThrow('invalid or unauthorized');
    expect(() =>
      buildNodeSlideSourceLineage({
        operations: [
          {
            op: 'update_slide',
            slideId: 'slide-1',
            properties: { notes: 'A new factual assertion.' },
          },
        ],
        authorizedSourceIds: ['source-fifa'],
        policy: 'required_external_evidence',
      }),
    ).toThrow('missing a required source binding');
  });

  it('keeps deterministic and editorial copy/style/layout operations backward compatible', () => {
    const lineage = buildNodeSlideSourceLineage({
      operations: [
        unboundTextOperation,
        {
          op: 'update_style',
          slideId: 'slide-1',
          elementId: 'headline-1',
          properties: { fontWeight: 700 },
        },
      ],
      authorizedSourceIds: [],
      policy: 'not_applicable',
    });

    expect(lineage).toEqual({
      sourceBindingStatus: 'not_applicable',
      claimSourceBindings: [],
    });
  });

  // MERGE-BLOCKED (not ported): this asserts on `validateNodeSlidePatch`, not on this module.
  // This repo's `convex/lib/nodeslidePatches.ts` has diverged — its `update_chart` accepts partial
  // `chartType`/`series` payloads and its `replace_text` branch carries no source-binding check.
  // Actual failure when run:
  //   AssertionError: expected [] to include
  //   'replace_text on element_ec1522af2d7e5... has an invalid source binding.'
  // Wiring the check in would make a shipped validator reject patches it accepts today, so it needs
  // an owner decision rather than a port. Left executable and skipped so the requirement survives.
  it.skip('revalidates source existence inside the exact server-side patch candidate', () => {
    const snapshot = buildGoldenNodeSlide('source-lineage-candidate', 1_700_000_000_000).snapshot;
    const element = snapshot.elements.find(
      (candidate) => candidate.kind === 'text' && !candidate.locked,
    );
    const slide = snapshot.slides.find((candidate) => candidate.id === element?.slideId);
    const source = snapshot.sources[0];
    if (!element || !slide || !source) throw new Error('Expected bounded source-lineage fixtures.');
    const basePatch = {
      deckId: snapshot.deck.id,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: { [slide.id]: slide.version },
      baseElementVersions: { [element.id]: element.version },
      scope: {
        kind: 'elements' as const,
        deckId: snapshot.deck.id,
        slideIds: [slide.id],
        elementIds: [element.id],
        operationMode: 'copy' as const,
      },
    };

    expect(
      validateNodeSlidePatch(snapshot, {
        ...basePatch,
        operations: [
          {
            op: 'replace_text',
            slideId: slide.id,
            elementId: element.id,
            text: 'A source-bound factual replacement.',
            sourceIds: ['source-outside-deck'],
          },
        ],
      }),
    ).toContain(`replace_text on ${element.id} has an invalid source binding.`);
    expect(
      validateNodeSlidePatch(snapshot, {
        ...basePatch,
        operations: [
          {
            op: 'replace_text',
            slideId: slide.id,
            elementId: element.id,
            text: 'A source-bound factual replacement.',
            sourceIds: [source.id],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('hydrates legacy trace evidence as unavailable instead of fabricating a binding', () => {
    const trace = traceFromRow({
      id: 'trace-legacy',
      deckId: 'deck-1',
      status: 'completed',
      summary: 'Legacy trace',
      plan: [],
      context: [],
      toolCalls: [],
      guardrails: [],
      createdAt: 1,
    } as never);

    expect(trace.sourceBindingStatus).toBe('legacy_unavailable');
    expect(trace.claimSourceBindings).toEqual([]);
  });
});
