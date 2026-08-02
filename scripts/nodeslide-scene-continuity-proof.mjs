import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(rootDirectory, 'evidence', 'scene-continuity-v2', 'generated');
const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  server: { hmr: false, middlewareMode: true },
});

try {
  const seed = await vite.ssrLoadModule('/convex/lib/nodeslideSeed.ts');
  const validationModule = await vite.ssrLoadModule('/convex/lib/nodeslideValidation.ts');
  const deckCiModule = await vite.ssrLoadModule('/convex/lib/nodeslideDeckCi.ts');
  const exporter = await vite.ssrLoadModule('/src/domains/nodeslide/slidelang/index.ts');
  const now = 1_700_000_000_000;
  const title =
    'Build exactly 12 slides for a risk committee deciding whether an AI release may proceed';
  const brief = {
    prompt:
      'Build exactly 12 slides for a risk committee deciding whether an AI release may proceed. Use only supplied qualitative evidence. Move the guarded threshold from exposed uncertainty through inspection to an explicit release state. Do not invent figures, weights, thresholds, formulas, dates, or operating rules.',
    audience: 'Risk committee',
    purpose: 'Decide whether the AI release gate may open',
    successCriteria: [
      'Preserve all twelve narrative jobs',
      'Separate supplied evidence from open assumptions',
      'Name the decision owner and next checkpoint',
    ],
  };
  const built = seed.buildBriefNodeSlide({
    deckId: 'deck-scene-continuity-v2',
    projectId: 'project-scene-continuity-v2',
    title,
    brief,
    themeId: 'editorial-signal',
    now,
  });
  const validation = validationModule.validateNodeSlideSnapshot(built.snapshot, now);
  const deckCi = deckCiModule.evaluateNodeSlideDeckCi(built.snapshot, { referenceTime: now });
  const sceneSignatures = built.snapshot.slides.map((slide) => {
    const marks = built.snapshot.elements
      .filter((element) => element.slideId === slide.id && element.role?.startsWith('story_scene_'))
      .map((element) => ({
        role: element.role,
        bbox: element.bbox,
        opacity: element.style.opacity,
      }));
    return JSON.stringify(marks);
  });
  const dominantSceneSlideCount = built.snapshot.slides.filter((slide) =>
    built.snapshot.elements.some(
      (element) => element.slideId === slide.id && element.role === 'story_scene_field',
    ),
  ).length;
  const report = {
    schemaVersion: 'nodeslide.scene-continuity-proof/v2',
    generatedAt: new Date().toISOString(),
    slideCount: built.snapshot.slides.length,
    requestedSlideCount: 12,
    exactCount: built.snapshot.slides.length === 12,
    story: {
      metaphor: built.spec.storySpec?.visualMetaphor,
      sceneStates: built.spec.storySpec?.sceneStates,
      uniqueSceneSignatures: new Set(sceneSignatures).size,
      dominantSceneSlideCount,
      legacyProgressRailCount: built.snapshot.elements.filter((element) =>
        element.role?.startsWith('story_motif_'),
      ).length,
    },
    archetypes: built.snapshot.slides.map((slide) => slide.archetype),
    diversity: built.spec.deckDiversity,
    validation: {
      publishOk: validation.publishOk,
      cleanOk: validation.cleanOk,
      issues: validation.issues,
    },
    deckCi: {
      status: deckCi.status,
      blockerCount: deckCi.blockerCount,
      checks: deckCi.checks,
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
  if (!report.exactCount) throw new Error(`Expected 12 slides; received ${report.slideCount}.`);
  if (report.story.uniqueSceneSignatures !== 12 || report.story.legacyProgressRailCount !== 0) {
    throw new Error(`Scene continuity failed: ${JSON.stringify(report.story)}.`);
  }
  if (report.story.dominantSceneSlideCount < 4) {
    throw new Error(
      `Scene continuity stayed decorative: expected at least 4 dominant scenes, found ${report.story.dominantSceneSlideCount}.`,
    );
  }
  if (!report.diversity?.passes) {
    throw new Error(`Composition diversity failed: ${JSON.stringify(report.diversity)}.`);
  }
  if (!report.validation.publishOk || report.deckCi.status !== 'pass') {
    throw new Error(
      `Release gates failed: ${JSON.stringify({ validation: report.validation, deckCi: report.deckCi })}.`,
    );
  }

  const pptxBinary = await exporter.buildPptx(built.snapshot);
  const pptx = Buffer.from(
    pptxBinary instanceof ArrayBuffer
      ? new Uint8Array(pptxBinary)
      : pptxBinary instanceof Uint8Array
        ? pptxBinary
        : new Uint8Array(await pptxBinary.arrayBuffer()),
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, 'risk-committee-scene-continuity.nodeslide.json'),
    `${JSON.stringify(built.snapshot, null, 2)}\n`,
  );
  await writeFile(
    path.join(outputDirectory, 'risk-committee-scene-continuity.report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    path.join(outputDirectory, 'risk-committee-scene-continuity.html'),
    exporter.renderDeckHtml(built.snapshot),
    'utf8',
  );
  await writeFile(path.join(outputDirectory, 'risk-committee-scene-continuity.pptx'), pptx);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await vite.close();
}
