import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildTimingTree,
  buildV3NativeDeck,
  compileArtifactSpec,
  excelSerial,
  ommlFromExpression,
  timelineDate,
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

  // The engineered primitives. Each existed nowhere in PowerPoint until it was built.
  it('emits a REAL c:dateAx time axis, so progression.timeline is satisfiable at all', async () => {
    const doc = await atlas();
    const { buffer } = await buildV3NativeDeck(doc.fixtures);
    const zip = await JSZip.loadAsync(buffer);
    const dated = [];
    for (const p of Object.keys(zip.files).filter((f) => /ppt\/charts\/chart\d+\.xml$/.test(f))) {
      const xml = await zip.file(p).async('string');
      if (!/<c:dateAx>/.test(xml)) continue;
      dated.push(p);
      // Spec-exact CT_DateAx: date-serial categories, a base time unit, and no CT_CatAx-only children.
      expect(xml, `${p} numCache`).toMatch(/<c:numCache>/);
      expect(xml, `${p} baseTimeUnit`).toMatch(/<c:baseTimeUnit val="days"\/>/);
      expect(xml, `${p} lblAlgn is CatAx-only`).not.toMatch(/<c:lblAlgn/);
      expect(xml, `${p} noMultiLvlLbl is CatAx-only`).not.toMatch(/<c:noMultiLvlLbl/);
    }
    // research-timeline + roadmap-gantt.
    expect(dated).toHaveLength(2);
  });

  it('converts unit offsets into real calendar serials', () => {
    const epochSerial = excelSerial(timelineDate(0, 'day'));
    expect(excelSerial(timelineDate(1, 'day'))).toBe(epochSerial + 1);
    expect(excelSerial(timelineDate(1, 'week'))).toBe(epochSerial + 7);
  });

  it('binds evidence claims to external source relationships, not decorative text', async () => {
    const doc = await atlas();
    const { buffer } = await buildV3NativeDeck(doc.fixtures);
    const zip = await JSZip.loadAsync(buffer);
    let linkedSlides = 0;
    for (const p of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      const xml = await zip.file(p).async('string');
      if (!/<a:hlinkClick/.test(xml)) continue;
      const relsPath = p.replace(/slides\/(slide\d+)\.xml$/, 'slides/_rels/$1.xml.rels');
      const rels = await zip.file(relsPath).async('string');
      expect(rels, `${p} external target`).toMatch(/TargetMode="External"/);
      linkedSlides += 1;
    }
    expect(linkedSlides).toBeGreaterThanOrEqual(4);
  });

  it('ships a real poster frame with every poster-frame fallback', async () => {
    const doc = await atlas();
    const specs = doc.fixtures.map(compileArtifactSpec).filter((s) => s?.kind === 'fallback');
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      if (spec.capability === 'poster-frame') {
        // A fallback that only promises a poster frame is not one the gate can accept.
        expect(spec.posterFrame?.path, spec.archetype).toBeTruthy();
      } else {
        // `unsupported` is a refusal, not a degradation: the evidence does not exist, so there is
        // nothing to show. It must still say precisely what is missing.
        expect(spec.capability, spec.archetype).toBe('unsupported');
        expect(spec.fallbackBehavior, spec.archetype).toMatch(/not fabricated|no measured/i);
      }
    }
  });

  it('emits a REAL p:timing build sequence for motion, not a poster frame', async () => {
    const doc = await atlas();
    const { buffer } = await buildV3NativeDeck(doc.fixtures);
    const zip = await JSZip.loadAsync(buffer);
    let animated = 0;
    for (const p of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      const xml = await zip.file(p).async('string');
      if (!/<p:timing>/.test(xml)) continue;
      animated += 1;
      const targets = [
        ...xml.matchAll(/<p:cTn\b[^>]*nodeType="clickEffect"[\s\S]*?<p:spTgt spid="(\d+)"/g),
      ].map((m) => m[1]);
      const stateIds = [...xml.matchAll(/<p:cNvPr id="(\d+)" name="state-/g)].map((m) => m[1]);
      // A staged reveal: >=2 build steps, each bound to a DISTINCT real state shape.
      expect(new Set(targets).size, `${p} distinct targets`).toBeGreaterThanOrEqual(2);
      expect(new Set(targets).size, `${p} no duplicate targets`).toBe(targets.length);
      for (const id of targets) expect(stateIds, `${p} target is a state shape`).toContain(id);
    }
    // evidence-scrollytelling + animated-chart-progression.
    expect(animated).toBe(2);
  });

  it('emits N-1 transitions for N states — the first is visible at slide entry', async () => {
    const doc = await atlas();
    const { buffer } = await buildV3NativeDeck(doc.fixtures);
    const zip = await JSZip.loadAsync(buffer);
    for (const p of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      const xml = await zip.file(p).async('string');
      if (!/<p:timing>/.test(xml)) continue;
      const states = [...xml.matchAll(/name="state-/g)].length;
      const transitions = (xml.match(/nodeType="clickEffect"/g) ?? []).length;
      // Animating all N would claim one more transition than the scene actually has.
      expect(transitions, `${p} N-1 transitions`).toBe(states - 1);
    }
  });

  it('declares step-build as a FALLBACK against scrub — never a native pass', async () => {
    const doc = await atlas();
    const motion = doc.fixtures.map(compileArtifactSpec).filter((s) => s?.kind === 'motion');
    expect(motion).toHaveLength(2);
    for (const spec of motion) {
      // PowerPoint advances on click: discrete. Calling that "scrub" would be an overclaim.
      expect(spec.capability, spec.archetype).toBe('native-step-build');
      expect(spec.fallbackBehavior, spec.archetype).toMatch(/not scrub/i);
      expect(spec.fallbackBehavior, spec.archetype).toMatch(/discrete user-advance/i);
    }
  });

  it('will not call a single fade-in a scene', () => {
    // The anti-gaming rule lives in the builder too: one state is not a staged reveal.
    expect(buildTimingTree(['5'])).toBe('');
    expect(buildTimingTree(['5', '7'])).toMatch(/nodeType="clickEffect"/);
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
