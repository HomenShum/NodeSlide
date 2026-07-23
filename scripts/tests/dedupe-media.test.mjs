import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { dedupeMedia } from '../build-atlas-native-pptx.mjs';

/**
 * PptxGenJS mints a fresh `ppt/media/*` part per addImage call, keyed on the call rather than on
 * the content, so a screenshot reused across six slides is stored six times. In the Atlas deck that
 * was 11 parts holding 5 distinct images — roughly half the package.
 *
 * The risk in fixing it is not the saving, it is substitution: a dedupe that merges on "close
 * enough" silently swaps one screenshot for another and every downstream gate still passes, because
 * the deck is structurally perfect and semantically wrong. So these tests are mostly about what it
 * must REFUSE to merge.
 */

const IMAGE_A = Buffer.from('PNG-BYTES-ALPHA-0123456789');
const IMAGE_B = Buffer.from('PNG-BYTES-BETA-9876543210');

/** A minimal package: media parts plus one rels file per slide pointing at them. */
async function deck(mediaByName, relsBySlide, contentTypes = null) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    contentTypes ??
      '<Types><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/></Types>',
  );
  for (const [name, bytes] of Object.entries(mediaByName)) zip.file(`ppt/media/${name}`, bytes);
  for (const [slide, targets] of Object.entries(relsBySlide)) {
    zip.file(
      `ppt/slides/_rels/slide${slide}.xml.rels`,
      `<Relationships>${targets
        .map((t, i) => `<Relationship Id="rId${i + 1}" Target="../media/${t}"/>`)
        .join('')}</Relationships>`,
    );
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

const openZip = (buffer) => JSZip.loadAsync(buffer);
const mediaNames = (zip) =>
  // JSZip materialises a 'ppt/media/' folder entry; only real files are parts.
  Object.keys(zip.files)
    .filter((n) => n.startsWith('ppt/media/') && !zip.files[n].dir)
    .sort();
const relsOf = (zip, slide) => zip.file(`ppt/slides/_rels/slide${slide}.xml.rels`).async('string');

describe('media dedupe: collapsing identical parts', () => {
  it('merges byte-identical parts and repoints every slide at the survivor', async () => {
    const input = await deck(
      { 'image-1-1.png': IMAGE_A, 'image-2-1.png': IMAGE_A, 'image-3-1.png': IMAGE_A },
      { 1: ['image-1-1.png'], 2: ['image-2-1.png'], 3: ['image-3-1.png'] },
    );
    const result = await dedupeMedia(input);
    expect(result.removed).toBe(2);
    expect(result.reclaimedBytes).toBe(IMAGE_A.length * 2);

    const zip = await openZip(result.buffer);
    expect(mediaNames(zip)).toEqual(['ppt/media/image-1-1.png']);
    // Every slide must still resolve to a real part — a dangling Target is a broken deck.
    for (const slide of [1, 2, 3]) {
      expect(await relsOf(zip, slide), `slide ${slide}`).toContain('image-1-1.png');
    }
  });

  it('leaves a deck of genuinely distinct images completely alone', async () => {
    const input = await deck(
      { 'a.png': IMAGE_A, 'b.png': IMAGE_B },
      { 1: ['a.png'], 2: ['b.png'] },
    );
    const result = await dedupeMedia(input);
    expect(result.removed).toBe(0);
    expect(result.reclaimedBytes).toBe(0);
    expect(result.buffer).toBe(input);
  });

  it('REFUSES to merge across file extensions even when the bytes match', async () => {
    // Identical bytes always share a format, so this can only fire on a mislabelled part — and
    // merging there would hand the survivor a Content_Types mapping for the wrong media type.
    const input = await deck(
      { 'same.png': IMAGE_A, 'same.jpeg': IMAGE_A },
      { 1: ['same.png'], 2: ['same.jpeg'] },
    );
    const result = await dedupeMedia(input);
    expect(result.removed).toBe(0);
    expect(mediaNames(await openZip(result.buffer))).toEqual([
      'ppt/media/same.jpeg',
      'ppt/media/same.png',
    ]);
  });

  it('never substitutes a different image, however close in size', async () => {
    const almost = Buffer.from(`${IMAGE_A.toString().slice(0, -1)}X`);
    expect(almost.length).toBe(IMAGE_A.length);
    const input = await deck({ 'a.png': IMAGE_A, 'b.png': almost }, { 1: ['a.png', 'b.png'] });
    const result = await dedupeMedia(input);
    expect(result.removed).toBe(0);
    const rels = await relsOf(await openZip(result.buffer), 1);
    expect(rels).toContain('a.png');
    expect(rels).toContain('b.png');
  });

  it('keeps a two-state pair as two DIFFERENT parts, so pair honesty survives', async () => {
    // The before/after slides are the reason this matters: collapsing them would turn an honest
    // pair into one image shown twice, which is the exact claim the asset gate hunts for.
    const input = await deck(
      {
        'image-5-1.png': IMAGE_A,
        'image-5-2.png': IMAGE_B,
        'image-21-1.png': IMAGE_B,
        'image-26-1.png': IMAGE_A,
      },
      { 5: ['image-5-1.png', 'image-5-2.png'], 21: ['image-21-1.png'], 26: ['image-26-1.png'] },
    );
    const result = await dedupeMedia(input);
    expect(result.removed).toBe(2);

    const zip = await openZip(result.buffer);
    const rels = await relsOf(zip, 5);
    const targets = [...rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => m[1]);
    expect(targets).toHaveLength(2);
    expect(new Set(targets).size).toBe(2);

    const digests = await Promise.all(
      targets.map(async (t) => (await zip.file(`ppt/media/${t}`).async('nodebuffer')).toString()),
    );
    expect(new Set(digests).size).toBe(2);
  });

  it('drops a part-specific Content_Types Override along with the part it names', async () => {
    // An Override outliving its part leaves the package invalid — PowerPoint refuses to open it.
    const input = await deck(
      { 'a.png': IMAGE_A, 'b.png': IMAGE_A },
      { 1: ['a.png'], 2: ['b.png'] },
      '<Types><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/media/b.png" ContentType="image/png"/></Types>',
    );
    const result = await dedupeMedia(input);
    const types = await (await openZip(result.buffer)).file('[Content_Types].xml').async('string');
    expect(types).not.toContain('/ppt/media/b.png');
    expect(types).toContain('Default Extension="png"');
  });

  it('is idempotent — running it again finds nothing left to collapse', async () => {
    const input = await deck(
      { 'a.png': IMAGE_A, 'b.png': IMAGE_A },
      { 1: ['a.png'], 2: ['b.png'] },
    );
    const once = await dedupeMedia(input);
    const twice = await dedupeMedia(once.buffer);
    expect(twice.removed).toBe(0);
  });

  it('handles a package with no media at all', async () => {
    const result = await dedupeMedia(await deck({}, { 1: [] }));
    expect(result.removed).toBe(0);
  });
});
