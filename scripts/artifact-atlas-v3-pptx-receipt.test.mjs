import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildAtlasV3PptxReceipt } from './lib/artifact-atlas-v3-pptx-receipt.mjs';

const PPTX_PATH = 'outputs/artifact-atlas-v3/nodeslide-artifact-atlas-v3.pptx';
const CANDIDATE_PATH = 'outputs/artifact-atlas-v3/atlas-v3-evidence-candidate.json';
const RECIPE_PATH = 'outputs/artifact-atlas-v3/atlas-v3-build-recipe.json';
const SOURCE_PATH = 'outputs/artifact-atlas-v2/nodeslide-artifact-atlas-v2.pptx';
const RELEASE_GATES_PATH = 'outputs/artifact-atlas-v3/atlas-v3-release-gates.json';

async function actualInputs() {
  const [pptxBytes, candidateBytes, buildRecipeBytes, sourceAtlasBytes, releaseGateBytes] =
    await Promise.all([
      readFile(PPTX_PATH),
      readFile(CANDIDATE_PATH),
      readFile(RECIPE_PATH),
      readFile(SOURCE_PATH),
      readFile(RELEASE_GATES_PATH),
    ]);
  const buildRecipe = JSON.parse(buildRecipeBytes.toString('utf8'));
  const evidenceBindings = buildRecipe.assets.flatMap((asset) => [
    asset.modelEvidence.planResult,
    asset.modelEvidence.showcaseReceipt,
  ]);
  const [builderBytes, receiptCoreBytes, templateStarterBytes] = await Promise.all([
    readFile(buildRecipe.inputs.builder.path),
    readFile(buildRecipe.inputs.receiptCore.path),
    readFile(buildRecipe.inputs.templateStarter.path),
  ]);
  return {
    pptxBytes,
    pptxPath: PPTX_PATH,
    candidateBytes,
    candidate: JSON.parse(candidateBytes.toString('utf8')),
    buildRecipeBytes,
    buildRecipe,
    sourceAtlasBytes,
    builderBytes,
    receiptCoreBytes,
    templateStarterBytes,
    releaseGateBytes,
    releaseGates: JSON.parse(releaseGateBytes.toString('utf8')),
    supportingEvidence: await Promise.all(
      evidenceBindings.map(async (binding) => ({
        path: binding.path,
        bytes: await readFile(binding.path),
      })),
    ),
  };
}

async function blankDeck(slideCount = 43) {
  const zip = new JSZip();
  zip.file(
    'docProps/app.xml',
    '<ap:Properties xmlns:ap="urn"><ap:Application>Walnut Exporter</ap:Application></ap:Properties>',
  );
  zip.file(
    'docProps/core.xml',
    '<coreProperties xmlns:dc="urn"><dc:creator>Walnut Exporter</dc:creator></coreProperties>',
  );
  for (let index = 1; index <= slideCount; index += 1) {
    zip.file(`ppt/slides/slide${index}.xml`, '<p:sld xmlns:p="urn"/>');
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('Artifact Atlas V3 final PPTX receipt', () => {
  it('integration-verifies the actual deck, candidate, recipe, composition, and embedded assets', async () => {
    const receipt = await buildAtlasV3PptxReceipt(await actualInputs());
    expect(receipt).toMatchObject({
      schemaVersion: 'nodeslide.artifact-atlas-v3-pptx-receipt/v2',
      slideCount: 43,
      generator: '@oai/artifact-tool',
      generatorEvidence: {
        exporterApplication: 'Walnut Exporter',
        creator: 'Walnut Exporter',
        receiptSlide: 43,
      },
      composition: {
        titleSlides: 1,
        auditedMuseumPreviewSlides: 37,
        evidenceAppendixSlides: 5,
        verifiedContentSlides: 43,
      },
      contentVerification: {
        verifiedSlideCount: 43,
        embeddedAssets: expect.arrayContaining([
          expect.objectContaining({
            sha256: `sha256:${'12bb656c83b2c750e453e77c73751051dbff515ee157275adf6cbda426976488'}`,
          }),
        ]),
      },
      publicReleaseApproved: false,
      promotionEligible: false,
      humanPreference: 'not_run',
      releaseGates: {
        repositoryGates: 'passed',
        productionJourney: 'pending',
        fleetAvailability: 'pending',
        atlasUiRenders: 'passed',
        blindPreference: 'pending',
        routingPromotion: 'hold',
        fineTuningRun: 'not_authorized',
      },
    });
    expect(receipt.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.candidateDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.buildRecipeDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('rejects a 43-slide blank deck instead of treating ZIP count as proof', async () => {
    const inputs = await actualInputs();
    inputs.pptxBytes = await blankDeck();
    await expect(buildAtlasV3PptxReceipt(inputs)).rejects.toThrow(
      /slide 1 is missing required text/u,
    );
  });

  it('rejects a foreign deck with a substituted required slide claim', async () => {
    const inputs = await actualInputs();
    const zip = await JSZip.loadAsync(inputs.pptxBytes);
    const slide = await zip.file('ppt/slides/slide1.xml').async('string');
    zip.file(
      'ppt/slides/slide1.xml',
      slide.replace('Typed evidence turns model variety into governed production', 'FOREIGN DECK'),
    );
    inputs.pptxBytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(buildAtlasV3PptxReceipt(inputs)).rejects.toThrow(
      /slide 1 is missing required text/u,
    );
  });

  it('rejects a mutation to an unanchored numeric fact', async () => {
    const inputs = await actualInputs();
    const zip = await JSZip.loadAsync(inputs.pptxBytes);
    const slide = await zip.file('ppt/slides/slide3.xml').async('string');
    expect(slide).toContain('<a:t>12</a:t>');
    zip.file('ppt/slides/slide3.xml', slide.replace('<a:t>12</a:t>', '<a:t>13</a:t>'));
    inputs.pptxBytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(buildAtlasV3PptxReceipt(inputs)).rejects.toThrow(/slide 3 textRunDigest/u);
  });

  it('rejects a tampered slide-42 embedded screenshot', async () => {
    const inputs = await actualInputs();
    const zip = await JSZip.loadAsync(inputs.pptxBytes);
    const rels = await zip.file('ppt/slides/_rels/slide42.xml.rels').async('string');
    const target = rels.match(/Type="[^"]*\/image" Target="\/([^"]+)"/u)?.[1];
    expect(target).toBeTruthy();
    const bytes = await zip.file(target).async('uint8array');
    bytes[0] ^= 0xff;
    zip.file(target, bytes);
    inputs.pptxBytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(buildAtlasV3PptxReceipt(inputs)).rejects.toThrow(
      /imagePayloadDigest|missing bound asset/u,
    );
  });

  it('rejects a slide-42 screenshot placement mutation', async () => {
    const inputs = await actualInputs();
    const zip = await JSZip.loadAsync(inputs.pptxBytes);
    const slide = await zip.file('ppt/slides/slide42.xml').async('string');
    const positionedPicture = slide.match(/(<p:pic\b[\s\S]*?<a:off x=")(\d+)("[^>]*>)/u);
    expect(positionedPicture).toBeTruthy();
    zip.file(
      'ppt/slides/slide42.xml',
      slide.replace(
        positionedPicture[0],
        `${positionedPicture[1]}${Number(positionedPicture[2]) + 1}${positionedPicture[3]}`,
      ),
    );
    inputs.pptxBytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(buildAtlasV3PptxReceipt(inputs)).rejects.toThrow(/pictureXmlDigest/u);
  });

  it('rejects a tampered screenshot asset manifest', async () => {
    const inputs = await actualInputs();
    inputs.buildRecipe = structuredClone(inputs.buildRecipe);
    inputs.buildRecipe.assets[0].sha256 = `sha256:${'f'.repeat(64)}`;
    inputs.buildRecipeBytes = new TextEncoder().encode(JSON.stringify(inputs.buildRecipe));
    await expect(buildAtlasV3PptxReceipt(inputs)).rejects.toThrow(/asset-set digest/u);
  });

  it('rejects tampered model telemetry and a manually asserted route-cost label', async () => {
    const telemetryTamper = await actualInputs();
    const planEntry = telemetryTamper.supportingEvidence.find((entry) =>
      entry.path.includes('anthropic-claude-sonnet-5.json'),
    );
    planEntry.json = JSON.parse(new TextDecoder().decode(planEntry.bytes));
    planEntry.bytes = new TextEncoder().encode(
      new TextDecoder()
        .decode(planEntry.bytes)
        .replace('"costMicroUsd": 5010', '"costMicroUsd": 0'),
    );
    await expect(buildAtlasV3PptxReceipt(telemetryTamper)).rejects.toThrow(
      /claude-sonnet-5 plan input does not match/u,
    );

    const labelTamper = await actualInputs();
    labelTamper.buildRecipe = structuredClone(labelTamper.buildRecipe);
    labelTamper.buildRecipe.assets[0].meta = '$0 / exact returned free route';
    labelTamper.buildRecipeBytes = new TextEncoder().encode(
      JSON.stringify(labelTamper.buildRecipe),
    );
    await expect(buildAtlasV3PptxReceipt(labelTamper)).rejects.toThrow(
      /route metadata is not evidence-derived/u,
    );
  });

  it('rejects RC filenames and incomplete decks', async () => {
    const rc = await actualInputs();
    rc.pptxPath = 'outputs/artifact-atlas-v3/nodeslide-artifact-atlas-v3-rc1.pptx';
    await expect(buildAtlasV3PptxReceipt(rc)).rejects.toThrow(/final, non-RC/u);
    const incomplete = await actualInputs();
    incomplete.pptxBytes = await blankDeck(42);
    await expect(buildAtlasV3PptxReceipt(incomplete)).rejects.toThrow(/43 ordered slides/u);
  });

  it('rejects a builder that does not match the reproducible build recipe', async () => {
    const inputs = await actualInputs();
    inputs.builderBytes = new TextEncoder().encode('foreign builder');
    await expect(buildAtlasV3PptxReceipt(inputs)).rejects.toThrow(
      /PPTX builder input does not match/u,
    );
  });

  it('rejects release-gate tampering and stale V2 museum footers', async () => {
    const gateTamper = await actualInputs();
    gateTamper.releaseGates = structuredClone(gateTamper.releaseGates);
    gateTamper.releaseGates.gates.blindPreference.status = 'passed';
    gateTamper.releaseGateBytes = new TextEncoder().encode(JSON.stringify(gateTamper.releaseGates));
    await expect(buildAtlasV3PptxReceipt(gateTamper)).rejects.toThrow(/blind preference/u);

    const footerTamper = await actualInputs();
    const zip = await JSZip.loadAsync(footerTamper.pptxBytes);
    const slide = await zip.file('ppt/slides/slide23.xml').async('string');
    expect(slide).toContain('ATLAS V3 23');
    zip.file('ppt/slides/slide23.xml', slide.replace('ATLAS V3 23', 'ATLAS V2 23'));
    footerTamper.pptxBytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(buildAtlasV3PptxReceipt(footerTamper)).rejects.toThrow(/stale museum footer/u);
  });
});
