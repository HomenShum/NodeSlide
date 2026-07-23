import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_SPECS, buildNativeAtlasDeck } from './build-atlas-native-pptx.mjs';

/**
 * The point of this builder is that its slides pass the parity topology gate where Atlas v3 fails.
 * v3 is all autoshapes; these assertions prove the emitted OOXML carries real semantic objects —
 * a native chart part, an a:tbl grid, an m:oMath, and connectors bound to node shapes.
 */
describe('native Atlas builder: emits real semantic objects, not autoshapes', () => {
  let zip;

  async function load() {
    if (!zip) zip = await JSZip.loadAsync(await buildNativeAtlasDeck());
    return zip;
  }

  const slide = async (n) => (await load()).file(`ppt/slides/slide${n}.xml`).async('string');

  it('produces one slide per artifact spec', async () => {
    const z = await load();
    const slides = Object.keys(z.files).filter((p) => /ppt\/slides\/slide\d+\.xml$/.test(p));
    expect(slides).toHaveLength(ARTIFACT_SPECS.length);
  });

  it('emits native chart PARTS for the data.* chart slides, not flat images', async () => {
    const z = await load();
    const chartParts = Object.keys(z.files).filter((p) => /ppt\/charts\/chart\d+\.xml$/.test(p));
    // Two chart specs (bar + line) → two native chart parts.
    expect(chartParts.length).toBe(2);
    const chartXml = await z.file(chartParts[0]).async('string');
    // A real chart carries a series and a value axis — the thing a flattened chart cannot.
    expect(chartXml).toMatch(/<c:ser>/);
    expect(chartXml).toMatch(/<c:valAx>/);
  });

  it('emits a real a:tbl grid for data.table', async () => {
    const xml = await slide(3);
    expect(xml).toMatch(/<a:tbl\b/);
    expect(xml).toMatch(/<a:tr\b/); // rows
    expect(xml).not.toMatch(/table-as-flat-image/);
  });

  it('emits native OMML for technical.equation', async () => {
    const xml = await slide(4);
    expect(xml).toMatch(/<m:oMath\b/);
    expect(xml).toMatch(/<m:f>/); // a fraction — real math structure, not a text run
    expect(xml).toMatch(/xmlns:m=/); // namespace declared so the part is well-formed
  });

  it('emits diagram connectors BOUND to node shapes (a real relationship object)', async () => {
    const xml = await slide(5);
    const connectors = xml.match(/<p:cxnSp>/g) ?? [];
    expect(connectors.length).toBe(4); // one per edge in the 5-node pipeline

    const nodeIds = [...xml.matchAll(/<p:cNvPr id="(\d+)" name="node-/g)].map((m) => m[1]);
    const stCxn = [...xml.matchAll(/<a:stCxn id="(\d+)"/g)].map((m) => m[1]);
    const endCxn = [...xml.matchAll(/<a:endCxn id="(\d+)"/g)].map((m) => m[1]);
    expect(stCxn.length).toBe(4);
    // Every connector endpoint references a real node id — not a floating line.
    for (const id of [...stCxn, ...endCxn]) expect(nodeIds).toContain(id);
  });

  it('keeps every emitted slide part tag-balanced', async () => {
    const z = await load();
    for (const p of Object.keys(z.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
      const xml = await z.file(p).async('string');
      const opens = (xml.match(/<[a-zA-Z]/g) ?? []).length;
      const closes = (xml.match(/<\//g) ?? []).length;
      const selfClosing = (xml.match(/\/>/g) ?? []).length;
      expect(opens, `${p} tag balance`).toBe(closes + selfClosing);
    }
  });
});
