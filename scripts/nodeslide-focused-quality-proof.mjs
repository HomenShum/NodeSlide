import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(rootDirectory, 'evidence', 'focused-quality-proof');
const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  server: { hmr: false, middlewareMode: true },
});

try {
  const seed = await vite.ssrLoadModule('/convex/lib/nodeslideSeed.ts');
  const validationModule = await vite.ssrLoadModule('/convex/lib/nodeslideValidation.ts');
  const exporter = await vite.ssrLoadModule('/src/domains/nodeslide/slidelang/index.ts');
  const brief = {
    prompt:
      'Build exactly 12 slides for a risk committee deciding whether an AI release gate can open. Use only supplied qualitative evidence, preserve the evidence boundary, and do not invent figures, weights, thresholds, formulas, dates, or operating rules.',
    audience: 'Risk committee',
    purpose: 'Decide whether the release gate can open',
    successCriteria: [
      'Preserve all twelve narrative jobs',
      'Separate supplied evidence from open assumptions',
      'Name ownership and the next decision checkpoint',
    ],
  };
  const built = seed.buildBriefNodeSlide({
    deckId: 'deck-focused-quality-proof',
    projectId: 'project-focused-quality-proof',
    title: 'From evidence boundary to release decision',
    brief,
    themeId: 'editorial-signal',
    now: 1_700_000_000_000,
  });
  const validation = validationModule.validateNodeSlideSnapshot(built.snapshot, 1_700_000_000_000);
  if (built.snapshot.slides.length !== 12) {
    throw new Error(`Expected 12 slides; received ${built.snapshot.slides.length}.`);
  }
  if (!built.spec.deckDiversity?.passes) {
    throw new Error(`Diversity failed: ${JSON.stringify(built.spec.deckDiversity)}`);
  }
  if (!validation.publishOk) {
    throw new Error(`Publication validation failed: ${JSON.stringify(validation.issues)}`);
  }

  const pptxBinary = await exporter.buildPptx(built.snapshot);
  const pptx = Buffer.from(
    pptxBinary instanceof ArrayBuffer
      ? new Uint8Array(pptxBinary)
      : pptxBinary instanceof Uint8Array
        ? pptxBinary
        : new Uint8Array(await pptxBinary.arrayBuffer()),
  );
  const html = exporter.renderDeckHtml(built.snapshot);
  const report = {
    generatedAt: new Date().toISOString(),
    slideCount: built.snapshot.slides.length,
    archetypes: built.snapshot.slides.map((slide) => slide.archetype),
    diversity: built.spec.deckDiversity,
    validation: {
      publishOk: validation.publishOk,
      cleanOk: validation.cleanOk,
      issues: validation.issues,
    },
    forbiddenLogic: {
      mathElements: built.snapshot.elements.filter((element) => element.kind === 'math').length,
      formulaTextMatches: built.snapshot.elements.filter(
        (element) =>
          typeof element.content === 'string' &&
          /\b(?:weighted|readiness|60\s*%|40\s*%)\b/iu.test(element.content),
      ).length,
    },
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, 'focused-quality-proof.nodeslide.json'),
    `${JSON.stringify(built.snapshot, null, 2)}\n`,
  );
  await writeFile(
    path.join(outputDirectory, 'focused-quality-proof.report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(path.join(outputDirectory, 'focused-quality-proof.html'), html, 'utf8');
  await writeFile(path.join(outputDirectory, 'focused-quality-proof.pptx'), pptx);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await vite.close();
}
