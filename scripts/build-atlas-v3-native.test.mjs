import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildV3NativeDeck,
  compileArtifactSpec,
  ommlFromExpression,
} from './build-atlas-v3-native.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function atlas() {
  return JSON.parse(
    await readFile(path.join(repoRoot, 'benchmarks/artifact-atlas/v2/atlas.json'), 'utf8'),
  );
}

const fixtureOf = (doc, artifactType) => doc.fixtures.find((f) => f.artifactType === artifactType);

describe('v3 native compiler: artifactSpec -> native OOXML', () => {
  it('compiles every one of the 38 canonical fixtures', async () => {
    const doc = await atlas();
    const compiled = doc.fixtures.map(compileArtifactSpec);
    expect(compiled.filter(Boolean)).toHaveLength(doc.fixtures.length);
  });

  it('carries the real payload numbers through, not placeholders', async () => {
    const doc = await atlas();
    const waterfall = compileArtifactSpec(fixtureOf(doc, 'waterfall'));
    const payload = fixtureOf(doc, 'waterfall').artifactSpec.payload;
    const values = waterfall.series[0].values;
    // baseline ... deltas ... final, straight from the fixture.
    expect(values[0]).toBe(payload.baseline);
    expect(values.at(-1)).toBe(payload.final);
    expect(values).toHaveLength(payload.deltas.length + 2);
  });

  it('routes archetypes that demand a lookup grid to a table, not a chart', async () => {
    const doc = await atlas();
    for (const type of ['operating-table-sparklines', 'model-compare', 'harness-compare']) {
      expect(compileArtifactSpec(fixtureOf(doc, type)).kind, type).toBe('table');
    }
  });

  it('turns a graph payload into nodes+edges that reference real node ids', async () => {
    const doc = await atlas();
    const spec = compileArtifactSpec(fixtureOf(doc, 'system-architecture'));
    expect(spec.kind).toBe('diagram');
    const ids = spec.nodes.map((n) => n.id);
    for (const [from, to] of spec.edges) {
      expect(ids).toContain(from);
      expect(ids).toContain(to);
    }
  });

  it('compiles the equation AST into real OMML structure (a fraction, not a slash)', async () => {
    const doc = await atlas();
    const spec = compileArtifactSpec(fixtureOf(doc, 'quality-cost-equation'));
    expect(spec.ommlBody).toMatch(/<m:f><m:num>/);
    expect(spec.ommlBody).toMatch(/<m:den>/);
    expect(spec.ommlBody).not.toMatch(/&lt;/);
  });

  it('emits nested OMML for nested expressions', () => {
    const omml = ommlFromExpression({
      op: 'divide',
      args: [
        { op: 'value', name: 'Q' },
        {
          op: 'add',
          args: [
            { op: 'value', name: 'one' },
            { op: 'value', name: 'C' },
          ],
        },
      ],
    });
    expect(omml.match(/<m:f>/g)).toHaveLength(1);
    expect(omml).toMatch(/<m:t>Q<\/m:t>/);
  });

  // The honesty rules: a missing artifact must never be fabricated to make the gate pass.
  it('refuses to draw a trace when the fixture has zero measured spans', async () => {
    const doc = await atlas();
    const spec = compileArtifactSpec(fixtureOf(doc, 'otel-trace'));
    expect(spec.kind).toBe('fallback');
    expect(spec.fallbackBehavior).toMatch(/no measured spans/i);
    expect(spec.fallbackBehavior).toMatch(/forbidden substitute/i);
  });

  it('refuses to fabricate a runtime result when sampleSize is zero', async () => {
    const doc = await atlas();
    const spec = compileArtifactSpec(fixtureOf(doc, 'code-runtime-proof'));
    expect(spec.kind).toBe('fallback');
    expect(spec.fallbackBehavior).toMatch(/not fabricated/i);
  });

  it('emits the native parts the deck claims', async () => {
    const doc = await atlas();
    const { buffer } = await buildV3NativeDeck(doc.fixtures);
    const zip = await JSZip.loadAsync(buffer);
    const charts = Object.keys(zip.files).filter((p) => /ppt\/charts\/chart\d+\.xml$/.test(p));
    expect(charts.length).toBeGreaterThanOrEqual(9);

    let tables = 0;
    let equations = 0;
    let connectors = 0;
    for (const p of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      const xml = await zip.file(p).async('string');
      tables += (xml.match(/<a:tbl\b/g) ?? []).length;
      equations += (xml.match(/<m:oMath\b/g) ?? []).length;
      connectors += (xml.match(/<p:cxnSp>/g) ?? []).length;
    }
    expect(tables).toBeGreaterThanOrEqual(4);
    expect(equations).toBe(1);
    expect(connectors).toBeGreaterThanOrEqual(20);
  });

  it('keeps every emitted slide part tag-balanced', async () => {
    const doc = await atlas();
    const { buffer } = await buildV3NativeDeck(doc.fixtures);
    const zip = await JSZip.loadAsync(buffer);
    for (const p of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      const xml = await zip.file(p).async('string');
      const opens = (xml.match(/<[a-zA-Z]/g) ?? []).length;
      const closes = (xml.match(/<\//g) ?? []).length;
      const selfClosing = (xml.match(/\/>/g) ?? []).length;
      expect(opens, `${p} tag balance`).toBe(closes + selfClosing);
    }
  });
});
