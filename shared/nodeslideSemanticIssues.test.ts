import { describe, expect, it } from 'vitest';
import {
  validateNodeSlideArtifactDepth,
  validateNodeSlideDeckRhythm,
} from './nodeslideSemanticIssues.js';

const codes = (value: ReturnType<typeof validateNodeSlideArtifactDepth>) =>
  value.map((entry) => entry.code);

describe('semantic depth issue catalog', () => {
  it('validates cross-symbol dimensional algebra', () => {
    const valid = validateNodeSlideArtifactDepth({
      kind: 'equation',
      payload: {
        expression: {
          op: 'divide',
          args: [
            { op: 'value', name: 'distance' },
            { op: 'value', name: 'time' },
          ],
        },
        symbolUnits: { distance: 'km', time: 'hour' },
        resultUnit: 'km/hour',
      },
    });
    expect(valid).toEqual([]);
    const invalid = validateNodeSlideArtifactDepth({
      kind: 'equation',
      payload: {
        expression: {
          op: 'add',
          args: [
            { op: 'value', name: 'distance' },
            { op: 'value', name: 'time' },
          ],
        },
        symbolUnits: { distance: 'km', time: 'hour' },
        resultUnit: 'km',
      },
    });
    expect(codes(invalid)).toContain('equation_unit_mismatch');
  });

  it('detects unreachable nodes and geometric edge crossings', () => {
    const issues = validateNodeSlideArtifactDepth({
      kind: 'graph',
      payload: {
        rootId: 'a',
        nodes: [
          { id: 'a', position: { x: 0, y: 0 } },
          { id: 'b', position: { x: 10, y: 10 } },
          { id: 'c', position: { x: 0, y: 10 } },
          { id: 'd', position: { x: 10, y: 0 } },
          { id: 'orphan', position: { x: 20, y: 20 } },
        ],
        edges: [
          { id: 'ab', from: 'a', to: 'b' },
          { id: 'cd', from: 'c', to: 'd' },
        ],
      },
    });
    expect(codes(issues)).toContain('graph_reachability_missing');
    expect(codes(issues)).toContain('graph_edge_crossing');
  });

  it('validates missing values and aligned uncertainty bounds', () => {
    const issues = validateNodeSlideArtifactDepth({
      kind: 'chart',
      payload: {
        series: [
          {
            values: [10, null],
            uncertainty: { lower: [12, 1], upper: [11, 2] },
          },
        ],
      },
    });
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        'chart_missing_value_policy_missing',
        'chart_uncertainty_invalid',
        'chart_uncertainty_missing_value_mismatch',
      ]),
    );
  });

  it('binds capture freshness, DOM bounds, OCR, and product version', () => {
    const issues = validateNodeSlideArtifactDepth(
      {
        kind: 'evidence-media',
        payload: {
          captureContract: {
            capturedAt: 100,
            maxAgeMs: 10,
            domSelector: '#proof',
            domBounds: { x: 0, y: 0, width: 0, height: 10 },
            ocrText: 'Passed',
            ocrTextDigest: 'invalid',
            productVersion: 'v1',
            expectedProductVersion: 'v2',
          },
        },
      },
      { now: 1000 },
    );
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        'evidence_capture_stale',
        'evidence_dom_bounds_invalid',
        'evidence_ocr_binding_missing',
        'evidence_product_version_mismatch',
      ]),
    );
  });

  it('replays raw runtime statistics and observed trace lineage', () => {
    const runtime = validateNodeSlideArtifactDepth({
      kind: 'runtime-proof',
      payload: {
        status: 'observed',
        sampleSize: 3,
        samples: [1, 2],
        aggregation: { kind: 'mean', value: 99 },
        environmentDigest: 'invalid',
      },
    });
    expect(codes(runtime)).toEqual(
      expect.arrayContaining([
        'runtime_raw_sample_mismatch',
        'runtime_aggregation_mismatch',
        'runtime_environment_binding_missing',
      ]),
    );
    const trace = validateNodeSlideArtifactDepth({
      kind: 'trace',
      payload: {
        status: 'observed',
        rawReceiptDigest: 'invalid',
        spans: [{ spanId: 'child', parentSpanId: 'missing', startMs: 3, endMs: 2 }],
      },
    });
    expect(codes(trace)).toEqual(
      expect.arrayContaining(['trace_raw_receipt_missing', 'trace_span_timing_invalid']),
    );
  });

  it('rejects color-only semantics and repetitive deck rhythm', () => {
    expect(
      codes(
        validateNodeSlideArtifactDepth({
          kind: 'risk-matrix',
          payload: { visualEncoding: { primary: 'color', redundant: [] } },
        }),
      ),
    ).toContain('visual_encoding_color_only');
    const slides = Array.from({ length: 4 }, (_, index) => ({
      textDominant: true,
      compositionSignature: 'same',
      archetype: 'editorial',
      narrativeJob: index < 2 ? 'repeat' : `job-${index}`,
      dominantArtifact: index === 0 ? '' : 'text',
    }));
    expect(validateNodeSlideDeckRhythm(slides).map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'deck_rhythm_text_run',
        'deck_rhythm_composition_repetition',
        'deck_rhythm_archetype_variety',
        'deck_narrative_job_repetition',
        'deck_dominant_artifact_missing',
      ]),
    );
  });
});
