import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  RECIPELANG_MAX_INPUT_BYTES,
  applyRecipePatch,
  compileRecipe,
  createRecipeGridSlideElement,
  projectRecipeGridToNodeSlide,
  renderRecipeSvg,
  verifyRecipeGridAlignment,
} from './index';
import type { RecipePatch, RecipeSnapshot } from './types';

const fixturePath = resolve(
  import.meta.dirname,
  '../../../benchmarks/recipelang/edge-data-contract.recipe.yaml',
);

async function fixture(): Promise<RecipeSnapshot> {
  return parse(await readFile(fixturePath, 'utf8')) as RecipeSnapshot;
}

describe('RecipeLang agent-neutral production scenarios', () => {
  it('lets a research lead prove a three-source merge and inspect the artifact edge contract', async () => {
    const snapshot = await fixture();
    const first = compileRecipe(snapshot);
    const second = compileRecipe(structuredClone(snapshot));
    expect(first.receipt).toEqual(second.receipt);
    expect(first.receipt).toMatchObject({
      contractErrors: 0,
      profile: 'recipe-grid',
      fallbackUsed: false,
      stages: 2,
    });
    expect(first.steps.find((step) => step.id === 'reduce-results')).toMatchObject({
      stage: 0,
      rowSpan: 3,
      provenance: ['research-a', 'research-b', 'research-c'],
    });
    expect(first.artifacts.find((artifact) => artifact.id === 'deduped-items')).toMatchObject({
      producer: 'reduce-results',
      consumers: ['synthesize'],
      provenance: ['research-a', 'research-b', 'research-c'],
      shape: 'DedupedItem[]',
    });
    const svg = renderRecipeSvg(snapshot).content;
    expect(svg).toContain('data-recipe-step="reduce-results"');
    expect(svg).toContain('DedupedItem[]');
    expect(svg).toContain('CODE');
    expect(svg).toContain('AGENT');
    expect(svg).toContain('data-row-span="3"');
    expect(rectFor(svg, 'data-recipe-step="reduce-results"', 'step-cell')).toEqual({
      height: 264,
      width: 280,
      x: 440,
      y: 112,
    });
    expect(rectFor(svg, 'data-recipe-step="synthesize"', 'step-cell')).toEqual({
      height: 264,
      width: 280,
      x: 720,
      y: 112,
    });
    expect(rectFor(svg, 'data-recipe-output="final-brief"', 'output-cell')).toEqual({
      height: 264,
      width: 220,
      x: 1000,
      y: 112,
    });
    const outputX = Number(
      svg.match(
        /data-recipe-output="final-brief"[^>]*><rect class="cell output-cell" x="(\d+(?:\.\d+)?)"/u,
      )?.[1],
    );
    expect(outputX).toBeLessThan(1100);
    const alignment = verifyRecipeGridAlignment(snapshot);
    expect(alignment).toMatchObject({
      schemaVersion: 'recipelang.alignment/v1',
      reference: 'cooking-for-engineers-trn',
      passed: true,
      checks: {
        contiguousColumns: true,
        leftToRight: true,
        mergedSpanIntegrity: true,
        outputConvergence: true,
        rowBoundaryAlignment: true,
      },
    });
    expect(alignment.issues).toEqual([]);
  });

  it('refuses an adversarial contract with a cycle, missing artifacts, and two producers', async () => {
    const snapshot = await fixture();
    snapshot.steps[0]?.consumes.push('final-brief', 'undeclared-secret');
    snapshot.steps[1]?.produces.push('deduped-items');
    const compiled = compileRecipe(snapshot);
    expect(compiled.receipt.contractErrors).toBeGreaterThanOrEqual(3);
    expect(compiled.receipt.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['cycle', 'missing_artifact', 'multiple_producers']),
    );
    expect(compiled.receipt.profile).toBe('contract-graph');
    expect(compiled.receipt.fallbackUsed).toBe(true);
  });

  it('refuses to imply that a skipped middle row participates in a merged action', async () => {
    const snapshot = await fixture();
    const firstStep = snapshot.steps[0];
    if (!firstStep) throw new Error('Fixture is missing its first step.');
    firstStep.consumes = ['results-a', 'results-c'];
    const alignment = verifyRecipeGridAlignment(snapshot);
    const compiled = compileRecipe(snapshot);
    expect(alignment.passed).toBe(false);
    expect(alignment.checks.mergedSpanIntegrity).toBe(false);
    expect(compiled.receipt).toMatchObject({
      crossingCount: 2,
      fallbackUsed: true,
      profile: 'contract-graph',
    });
    expect(alignment.issues).toContain('Recipe-grid alignment check failed: mergedSpanIntegrity.');
    expect(() => renderRecipeSvg(snapshot)).toThrow(/cannot faithfully render/u);
  });

  it('keeps CAS and idempotency honest when two agents race to patch the same recipe', async () => {
    const snapshot = await fixture();
    const patch: RecipePatch = {
      schemaVersion: 'recipelang.patch/v1',
      commandId: 'cmd_agent_7_turn_82',
      idempotencyKey: 'agent-7:turn-82',
      baseVersion: 12,
      operations: [{ op: 'render.setProfile', profile: 'pipeline' }],
    };
    const first = applyRecipePatch(snapshot, patch);
    expect(first.receipt).toMatchObject({ applied: true, baseVersion: 12, resultingVersion: 13 });
    expect(() => applyRecipePatch(first.snapshot, { ...patch, commandId: 'racing-agent' })).toThrow(
      /CAS conflict/,
    );
    const replay = applyRecipePatch(first.snapshot, patch, [first.receipt]);
    expect(replay.receipt.applied).toBe(false);
    expect(replay.snapshot).toEqual(first.snapshot);
  });

  it('stays bounded and stable for a sustained 512-step institutional pipeline', () => {
    const steps = Array.from({ length: 512 }, (_, index) => ({
      id: `step-${String(index).padStart(4, '0')}`,
      label: `Transform ${index}`,
      consumes: [index === 0 ? 'seed' : `artifact-${index - 1}`],
      produces: [`artifact-${index}`],
      executor: {
        kind: 'code' as const,
        runtime: 'javascript',
        deterministic: true as const,
      },
    }));
    const snapshot: RecipeSnapshot = {
      schemaVersion: 'recipelang/v1',
      kind: 'Recipe',
      meta: { id: 'institutional-history', title: 'Institutional history replay', version: 99 },
      inputs: [{ id: 'archive', label: 'Portfolio archive', produces: 'seed' }],
      artifacts: [
        { id: 'seed', shape: 'Record[]' },
        ...steps.map((_, index) => ({ id: `artifact-${index}`, shape: 'Record[]' })),
      ],
      steps,
      outputs: [{ artifact: 'artifact-511', label: 'Current brief' }],
    };
    const compiled = compileRecipe(snapshot);
    expect(compiled.receipt).toMatchObject({
      contractErrors: 0,
      layoutOverflow: 506,
      stages: 512,
    });
    expect(compileRecipe(structuredClone(snapshot)).receipt.snapshotHash).toBe(
      compiled.receipt.snapshotHash,
    );
  });

  it('rejects a multi-megabyte agent payload before normalization can amplify it', async () => {
    const snapshot = await fixture();
    snapshot.meta.description = 'x'.repeat(RECIPELANG_MAX_INPUT_BYTES + 1);
    const compiled = compileRecipe(snapshot);
    expect(compiled.receipt).toMatchObject({
      contractErrors: 1,
      diagnostics: [
        {
          code: 'bound_exceeded',
          severity: 'error',
        },
      ],
    });
  });

  it('projects the same typed snapshot into a native NodeSlide recipe element and editable primitives', async () => {
    const snapshot = await fixture();
    const element = createRecipeGridSlideElement(snapshot);
    const projection = projectRecipeGridToNodeSlide(snapshot);
    expect(element.type).toBe('recipe-grid');
    expect(element.snapshot).toEqual(projection.element.snapshot);
    expect(projection.primitives).toHaveLength(6);
    expect(
      projection.primitives.every(
        (primitive) => primitive.metadata.recipeSnapshotId === snapshot.meta.id,
      ),
    ).toBe(true);
    expect(
      projection.primitives.find((primitive) => primitive.metadata.entityId === 'reduce-results')
        ?.bbox.height,
    ).toBeGreaterThan(0.2);
  });
});

function rectFor(svg: string, groupAttribute: string, className: string) {
  const groupStart = svg.indexOf(groupAttribute);
  const rect = svg
    .slice(groupStart)
    .match(
      new RegExp(
        `<rect class="cell ${className}" x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`,
        'u',
      ),
    );
  if (!rect) throw new Error(`Missing ${className} geometry after ${groupAttribute}.`);
  return {
    x: Number(rect[1]),
    y: Number(rect[2]),
    width: Number(rect[3]),
    height: Number(rect[4]),
  };
}
