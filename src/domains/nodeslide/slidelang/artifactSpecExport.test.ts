import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_AUTHORED_ARTIFACT_VERSION,
  NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
} from '../../../../convex/lib/nodeslideAuthoredArtifact';
import { buildBriefNodeSlide, buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { renderDeckHtml } from './html';
import { buildPptx } from './pptx';
import { validateSnapshot } from './validation';

describe('ArtifactSpec export gate', () => {
  it('blocks HTML and PowerPoint before rendering a semantically malformed artifact', async () => {
    const snapshot = buildGoldenNodeSlide('artifact-export-gate', 1_700_000_000_000).snapshot;
    const chart = snapshot.elements.find((element) => element.kind === 'chart');
    if (!chart?.chart) throw new Error('Golden deck chart unavailable.');
    chart.chart.series[0]?.values.pop();

    const validation = validateSnapshot(snapshot);
    expect(validation.artifactCompilation?.status).toBe('failed');
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'artifact_spec',
          severity: 'error',
          message: expect.stringContaining('artifact_chart_shape'),
        }),
      ]),
    );
    expect(validation.publishOk).toBe(false);
    expect(() => renderDeckHtml(snapshot)).toThrow(/ArtifactSpec compilation failed/);
    await expect(buildPptx(snapshot)).rejects.toThrow(/ArtifactSpec compilation failed/);
  });

  it('carries a canonical model-authored chart through deterministic HTML and editable PowerPoint', async () => {
    const slides = Array.from({ length: 6 }, (_, index) => ({
      title: `Slide ${index + 1}`,
      section: 'Review',
      headline: `Decision ${index + 1}`,
      body: 'Keep the decision bounded and inspectable.',
      bullets: ['Context', 'Action', 'Outcome'],
    }));
    slides[1] = {
      ...slides[1],
      artifactSpec: {
        schemaVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
        id: 'activation-chart',
        kind: 'chart',
        narrativeJob: 'Compare activation from baseline to target.',
        claimIds: ['claim:activation'],
        sourceIds: ['brief:success-criteria'],
        provenance: {
          truthState: 'derived',
          rationale: 'Values are derived from the bounded success criteria.',
          sourceRefs: ['brief:success-criteria'],
        },
        payload: {
          unit: '%',
          xAxis: { labels: ['Baseline', 'Current', 'Target'] },
          yAxis: { min: 0, max: 100 },
          series: [{ id: 'activation', values: [24, 42, 60] }],
        },
      },
    } as (typeof slides)[number] & { artifactSpec: unknown };
    slides[2] = {
      ...slides[2],
      artifactSpec: {
        schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
        id: 'activation-metric',
        kind: 'metric',
        narrativeJob: 'Land the current activation rate.',
        provenance: {
          truthState: 'derived',
          rationale: 'Value is derived from the bounded success criteria.',
          sourceRefs: ['brief:success-criteria'],
        },
        payload: { displayValue: '42%', label: 'Activation rate' },
      },
    } as (typeof slides)[number] & { artifactSpec: unknown };
    const snapshot = buildBriefNodeSlide({
      deckId: 'deck-authored-export',
      projectId: 'project-authored-export',
      title: 'Typed export path',
      brief: {
        prompt: 'Create a typed activation review.',
        audience: 'Operators',
        purpose: 'choose the next activation experiment',
        successCriteria: ['Observed activation is 42%; compare 24%, 42%, and 60%'],
      },
      themeId: 'quiet-precision',
      rawSpec: { title: 'Typed export path', narrative: ['Frame', 'Measure'], slides },
      now: 1_700_000_000_000,
    }).snapshot;

    const html = renderDeckHtml(snapshot);
    const pptx = await buildPptx(snapshot);

    expect(validateSnapshot(snapshot).artifactCompilation?.status).toBe('passed');
    expect(html).toContain('data-element-kind="chart"');
    expect(html).toContain('Baseline');
    expect(pptx.byteLength).toBeGreaterThan(10_000);
  });

  it('exports native waterfall marks as semantic HTML and editable PowerPoint shapes', async () => {
    const slides = Array.from({ length: 6 }, (_, index) => ({
      title: `Slide ${index + 1}`,
      section: 'Native proof',
      headline: `Native artifact ${index + 1}`,
      body: 'Keep geometry editable from browser through PowerPoint.',
      bullets: ['Typed', 'Proportional', 'Source-bound'],
    }));
    slides[0] = {
      ...slides[0],
      artifactSpec: {
        schemaVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
        id: 'native-waterfall',
        kind: 'waterfall',
        narrativeJob: 'Reconcile the baseline to the final outcome.',
        claimIds: ['claim:waterfall'],
        sourceIds: ['brief:prompt'],
        provenance: {
          truthState: 'derived',
          rationale: 'The bounded creation brief supplies the reconciliation values.',
          sourceRefs: ['brief:prompt'],
        },
        payload: {
          unit: 'points',
          baseline: 50,
          deltas: [
            { label: 'Quality', value: 10 },
            { label: 'Repair', value: 5 },
          ],
          final: 65,
          tolerance: 0,
        },
      },
    } as (typeof slides)[number] & { artifactSpec: unknown };
    slides[1] = {
      ...slides[1],
      artifactSpec: {
        schemaVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
        id: 'native-spatial',
        kind: 'spatial-scene',
        narrativeJob: 'Show nested viewport scale.',
        claimIds: ['claim:spatial'],
        sourceIds: ['brief:prompt'],
        provenance: {
          truthState: 'illustrative',
          rationale: 'The nested viewport is an explicit design illustration.',
          sourceRefs: ['brief:prompt'],
        },
        payload: {
          viewports: [
            { id: 'whole', level: 1 },
            {
              id: 'selected',
              level: 2,
              selectedNodeId: 'compiler',
              sourceIds: ['brief:prompt'],
            },
          ],
        },
      },
    } as (typeof slides)[number] & { artifactSpec: unknown };
    const snapshot = buildBriefNodeSlide({
      deckId: 'deck-native-export',
      projectId: 'project-native-export',
      title: 'Native export proof',
      brief: {
        prompt: 'Use an editable waterfall and a spatial viewport.',
        audience: 'Export reviewers',
        purpose: 'verify native browser and PowerPoint objects',
        successCriteria: ['Preserve proportional geometry'],
      },
      themeId: 'quiet-precision',
      rawSpec: { title: 'Native export proof', narrative: ['Compile', 'Export'], slides },
      now: 1_700_000_000_000,
    }).snapshot;

    const validation = validateSnapshot(snapshot);
    const html = renderDeckHtml(snapshot);
    const binary = await buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    if (!slideXml) throw new Error('Missing native waterfall slide XML.');

    expect(validation.artifactCompilation?.status).toBe('passed');
    expect(html).toContain('data-element-kind="shape"');
    expect(html).toContain('Waterfall bar: Quality');
    expect(html).toContain('Quality');
    expect(slideXml).toContain('<p:sp>');
    expect(slideXml).toContain('<a:t>Quality</a:t>');
    expect(slideXml).toContain('<a:t>10 points</a:t>');
    expect(Object.keys(zip.files).some((path) => /^ppt\/charts\/chart\d+\.xml$/u.test(path))).toBe(
      false,
    );
  });
});
