import { compileRecipe, recipeHash } from './compiler';
import type {
  CompiledRecipe,
  NodeSlideRecipePrimitive,
  RecipeCompiledStep,
  RecipeGridAlignmentReceipt,
  RecipeGridSlideElement,
  RecipeSnapshot,
} from './types';

const WIDTH = 1440;
const HEADER = 112;
const ROW_HEIGHT = 88;
const INPUT_WIDTH = 220;
const STAGE_WIDTH = 280;
const OUTPUT_WIDTH = 220;

export function renderRecipeSvg(value: unknown): { content: string; compiled: CompiledRecipe } {
  const compiled = compileRecipe(value, 'recipe-grid');
  if (compiled.receipt.crossingCount > 0) {
    throw new Error(
      'RecipeGrid cannot faithfully render non-contiguous source rows; use contract-graph.',
    );
  }
  const rows = Math.max(1, compiled.snapshot.inputs.length);
  const stageCount = Math.max(1, compiled.receipt.stages);
  const height = HEADER + rows * ROW_HEIGHT + 96;
  const stageWidth = Math.min(STAGE_WIDTH, (WIDTH - INPUT_WIDTH - OUTPUT_WIDTH - 64) / stageCount);
  const gridWidth = INPUT_WIDTH + stageCount * stageWidth + OUTPUT_WIDTH;
  const gridX = Math.max(32, (WIDTH - gridWidth) / 2);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="recipe-title recipe-desc">`,
    '<style>text{font-family:Arial,sans-serif}.title{font-size:34px;font-weight:700}.sub{font-size:15px;fill:#596170}.cell{fill:#fff;stroke:#aeb8c5;stroke-width:1.5}.input-cell{fill:#f4f7f9}.step-cell{fill:#fff}.output-cell{fill:#eef7f2}.contract{font-size:13px;fill:#6a7280}.label{font-size:17px;font-weight:650;fill:#17202a}.badge{font-size:11px;font-weight:700;letter-spacing:1px;fill:#fff}.stage{font-size:12px;font-weight:700;fill:#8a4b2c;letter-spacing:1px}.note{fill:#fff4d8;stroke:#e0b04b}</style>',
    '<rect width="100%" height="100%" fill="#f7f5ef"/>',
    `<text id="recipe-title" class="title" x="48" y="54">${escapeXml(compiled.snapshot.meta.title)}</text>`,
    `<text id="recipe-desc" class="sub" x="48" y="82">${escapeXml(compiled.snapshot.meta.description ?? 'Typed artifacts make every handoff inspectable.')}</text>`,
    `<text class="stage" x="${gridX + 12}" y="${HEADER - 14}">INPUT</text>`,
  ];

  for (let row = 0; row < rows; row += 1) {
    const input = compiled.snapshot.inputs[row];
    const y = HEADER + row * ROW_HEIGHT;
    parts.push(
      cell(
        gridX,
        y,
        INPUT_WIDTH,
        ROW_HEIGHT,
        input?.label ?? '—',
        input ? shapeFor(compiled, input.produces) : '',
        'input-cell',
        row,
        1,
      ),
    );
  }

  for (let stage = 0; stage < stageCount; stage += 1) {
    const x = gridX + INPUT_WIDTH + stage * stageWidth;
    parts.push(`<text class="stage" x="${x + 12}" y="${HEADER - 14}">STAGE ${stage}</text>`);
    const steps = compiled.steps.filter((step) => step.stage === stage);
    for (const step of steps) {
      const sourceRows = rowIndexes(compiled, step);
      const topRow = sourceRows.length ? Math.min(...sourceRows) : 0;
      const rowSpan = contiguousSpan(sourceRows);
      const y = HEADER + topRow * ROW_HEIGHT;
      const height = rowSpan * ROW_HEIGHT;
      parts.push(
        `<g data-recipe-step="${escapeXml(step.id)}" data-row-start="${topRow}" data-row-span="${rowSpan}">`,
        `<rect class="cell step-cell" x="${x}" y="${y}" width="${stageWidth}" height="${height}"/>`,
        badge(x + 14, y + 16, executorLabel(step), executorColor(step)),
        svgText(step.label, x + 14, y + 58, stageWidth - 28, 'label'),
        svgText(
          step.produces.map((id) => shapeFor(compiled, id)).join(' · '),
          x + 14,
          y + Math.min(height - 18, 104),
          stageWidth - 28,
          'contract',
        ),
        '</g>',
      );
    }
  }

  const outputX = gridX + INPUT_WIDTH + stageCount * stageWidth;
  parts.push(`<text class="stage" x="${outputX + 12}" y="${HEADER - 14}">OUTPUT</text>`);
  for (const output of compiled.snapshot.outputs) {
    const outputRows = artifactRowIndexes(compiled, output.artifact);
    const topRow = outputRows.length ? Math.min(...outputRows) : 0;
    const rowSpan = contiguousSpan(outputRows);
    const y = HEADER + topRow * ROW_HEIGHT;
    parts.push(
      `<g data-recipe-output="${escapeXml(output.artifact)}" data-row-start="${topRow}" data-row-span="${rowSpan}">${cellBody(
        outputX,
        y,
        OUTPUT_WIDTH,
        rowSpan * ROW_HEIGHT,
        output.label,
        shapeFor(compiled, output.artifact),
        'output-cell',
        topRow,
        rowSpan,
      )}</g>`,
    );
  }

  for (const note of compiled.snapshot.notes ?? []) {
    const step = compiled.steps.find((item) => item.id === note.anchor);
    if (!step) continue;
    const x = gridX + INPUT_WIDTH + 4 + step.stage * stageWidth;
    const y = height - 70;
    parts.push(
      `<rect class="note" x="${x}" y="${y}" width="${Math.min(420, stageWidth * 1.5)}" height="42" rx="10"/>`,
      svgText(note.body, x + 12, y + 26, Math.min(396, stageWidth * 1.5 - 24), 'contract'),
    );
  }
  parts.push('</svg>');
  return { content: parts.join(''), compiled };
}

export function verifyRecipeGridAlignment(value: unknown): RecipeGridAlignmentReceipt {
  const compiled = compileRecipe(value, 'recipe-grid');
  const stageCount = Math.max(1, compiled.receipt.stages);
  const stageWidth = Math.min(STAGE_WIDTH, (WIDTH - INPUT_WIDTH - OUTPUT_WIDTH - 64) / stageCount);
  const gridWidth = INPUT_WIDTH + stageCount * stageWidth + OUTPUT_WIDTH;
  const gridX = Math.max(32, (WIDTH - gridWidth) / 2);
  const columns = [
    { x: gridX, width: INPUT_WIDTH },
    ...Array.from({ length: stageCount }, (_, stage) => ({
      x: gridX + INPUT_WIDTH + stage * stageWidth,
      width: stageWidth,
    })),
    { x: gridX + INPUT_WIDTH + stageCount * stageWidth, width: OUTPUT_WIDTH },
  ];
  const contiguousColumns = columns.slice(1).every((column, index) => {
    const previous = columns[index];
    return previous !== undefined && column.x === previous.x + previous.width;
  });
  const mergedSpanIntegrity = compiled.steps.every((step) => {
    const indexes = rowIndexes(compiled, step);
    return indexes.length <= 1 || contiguousSpan(indexes) === indexes.length;
  });
  const outputConvergence = compiled.snapshot.outputs.every((output) => {
    const indexes = artifactRowIndexes(compiled, output.artifact);
    return indexes.length > 0 && contiguousSpan(indexes) === indexes.length;
  });
  const checks = {
    contiguousColumns,
    leftToRight: columns.every(
      (column, index) => index === 0 || column.x > (columns[index - 1]?.x ?? column.x),
    ),
    mergedSpanIntegrity,
    outputConvergence,
    rowBoundaryAlignment: compiled.steps.every((step) => {
      const indexes = rowIndexes(compiled, step);
      const topRow = indexes.length ? Math.min(...indexes) : 0;
      const span = contiguousSpan(indexes);
      return (
        (HEADER + topRow * ROW_HEIGHT - HEADER) % ROW_HEIGHT === 0 &&
        (span * ROW_HEIGHT) % ROW_HEIGHT === 0
      );
    }),
  };
  const issues = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => `Recipe-grid alignment check failed: ${name}.`);
  return {
    schemaVersion: 'recipelang.alignment/v1',
    reference: 'cooking-for-engineers-trn',
    passed: issues.length === 0,
    checks,
    issues,
  };
}

export function renderRecipeHtml(value: unknown): { content: string; compiled: CompiledRecipe } {
  const { content: svg, compiled } = renderRecipeSvg(value);
  const alignment = verifyRecipeGridAlignment(compiled.snapshot);
  const diagnostics = compiled.receipt.diagnostics
    .map(
      (item) =>
        `<li data-severity="${item.severity}"><strong>${escapeXml(item.code)}</strong> ${escapeXml(item.message)}</li>`,
    )
    .join('');
  return {
    compiled,
    content: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeXml(compiled.snapshot.meta.title)}</title><style>body{margin:0;background:#171a1f;color:#17202a;font-family:Arial,sans-serif}main{max-width:1440px;margin:32px auto;background:#f7f5ef;box-shadow:0 24px 80px #0008}svg{width:100%;height:auto;display:block}aside{padding:20px 36px;border-top:1px solid #d8d5cb}a{color:#276a98}li[data-severity=error]{color:#9a2e22}</style></head><body><main data-recipelang="${compiled.snapshot.schemaVersion}" data-snapshot-hash="${compiled.receipt.snapshotHash}" data-alignment-reference="${alignment.reference}" data-alignment-passed="${alignment.passed}">${svg}<aside><p><a href="https://www.cookingforengineers.com/">Alignment reference: Cooking for Engineers Tabular Recipe Notation</a> — shared row boundaries, merged consumption spans, and left-to-right convergence.</p><strong>RecipeReceipt</strong><pre>${escapeXml(JSON.stringify(compiled.receipt, null, 2))}</pre><strong>AlignmentReceipt</strong><pre>${escapeXml(JSON.stringify(alignment, null, 2))}</pre>${diagnostics ? `<ul>${diagnostics}</ul>` : ''}</aside></main></body></html>`,
  };
}

export function createRecipeGridSlideElement(
  snapshot: RecipeSnapshot,
  id = `recipe-grid:${snapshot.meta.id}`,
): RecipeGridSlideElement {
  const compiled = compileRecipe(snapshot, 'recipe-grid');
  return {
    type: 'recipe-grid',
    id,
    recipeSnapshotId: snapshot.meta.id,
    snapshot: compiled.snapshot,
    view: {
      profile: 'recipe-grid',
      showContracts: compiled.snapshot.render?.showContracts ?? true,
      showExecutorBadges: compiled.snapshot.render?.showExecutorBadges ?? true,
      showNotes: compiled.snapshot.render?.showNotes ?? true,
    },
    receipt: compiled.receipt,
  };
}

export function projectRecipeGridToNodeSlide(value: unknown): {
  element: RecipeGridSlideElement;
  primitives: NodeSlideRecipePrimitive[];
} {
  const compiled = compileRecipe(value, 'recipe-grid');
  const element = createRecipeGridSlideElement(compiled.snapshot);
  const primitives: NodeSlideRecipePrimitive[] = [];
  const inputs = compiled.snapshot.inputs;
  for (const [row, input] of inputs.entries()) {
    primitives.push(
      primitive(
        compiled,
        input.id,
        'input',
        'recipe_input',
        input.label,
        0.03,
        0.16 + row * 0.11,
        0.15,
        0.09,
      ),
    );
  }
  const stages = Math.max(1, compiled.receipt.stages);
  for (const step of compiled.steps) {
    const indexes = rowIndexes(compiled, step);
    const row = indexes.length ? Math.min(...indexes) : 0;
    primitives.push(
      primitive(
        compiled,
        step.id,
        'step',
        `recipe_step_${step.executor.kind}`,
        `${executorLabel(step)} · ${step.label}`,
        0.22 + (step.stage / stages) * 0.52,
        0.16 + row * 0.11,
        Math.min(0.22, 0.46 / stages),
        Math.max(0.09, contiguousSpan(indexes) * 0.11),
      ),
    );
  }
  for (const output of compiled.snapshot.outputs) {
    const indexes = artifactRowIndexes(compiled, output.artifact);
    const row = indexes.length ? Math.min(...indexes) : 0;
    primitives.push(
      primitive(
        compiled,
        output.artifact,
        'output',
        'recipe_output',
        output.label,
        0.79,
        0.16 + row * 0.11,
        0.18,
        Math.max(0.09, contiguousSpan(indexes) * 0.11),
      ),
    );
  }
  return { element, primitives };
}

function primitive(
  compiled: CompiledRecipe,
  entityId: string,
  entityKind: NodeSlideRecipePrimitive['metadata']['entityKind'],
  role: string,
  content: string,
  x: number,
  y: number,
  width: number,
  height: number,
): NodeSlideRecipePrimitive {
  return {
    id: `${compiled.snapshot.meta.id}:${entityId}`,
    kind: 'shape',
    role,
    content,
    bbox: { x, y, width, height },
    metadata: {
      recipeSnapshotId: compiled.snapshot.meta.id,
      entityId,
      entityKind,
      contentHash: recipeHash({ entityId, content, x, y, width, height }),
    },
  };
}

function rowIndexes(compiled: CompiledRecipe, step: RecipeCompiledStep): number[] {
  const ids = new Set(step.provenance);
  return compiled.snapshot.inputs.flatMap((input, index) => (ids.has(input.id) ? [index] : []));
}

function artifactRowIndexes(compiled: CompiledRecipe, artifactId: string): number[] {
  const artifact = compiled.artifacts.find((item) => item.id === artifactId);
  if (!artifact) return [];
  const ids = new Set(artifact.provenance);
  return compiled.snapshot.inputs.flatMap((input, index) => (ids.has(input.id) ? [index] : []));
}

function contiguousSpan(indexes: number[]): number {
  return indexes.length ? Math.max(...indexes) - Math.min(...indexes) + 1 : 1;
}

function shapeFor(compiled: CompiledRecipe, artifactId: string): string {
  return compiled.artifacts.find((artifact) => artifact.id === artifactId)?.shape ?? artifactId;
}

function executorLabel(step: RecipeCompiledStep): string {
  return step.executor.kind.toUpperCase();
}

function executorColor(step: RecipeCompiledStep): string {
  return (
    {
      code: '#206b57',
      agent: '#744fc6',
      human: '#a55c24',
      tool: '#276a98',
      wait: '#606976',
    } as const
  )[step.executor.kind];
}

function badge(x: number, y: number, label: string, color: string): string {
  const width = 42 + label.length * 5;
  return `<rect x="${x}" y="${y}" width="${width}" height="24" rx="12" fill="${color}"/><text class="badge" x="${x + 12}" y="${y + 16}">${label}</text>`;
}

function cell(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  contract: string,
  className: string,
  rowStart: number,
  rowSpan: number,
) {
  return `<g data-row-start="${rowStart}" data-row-span="${rowSpan}">${cellBody(
    x,
    y,
    width,
    height,
    label,
    contract,
    className,
    rowStart,
    rowSpan,
  )}</g>`;
}

function cellBody(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  contract: string,
  className: string,
  rowStart: number,
  rowSpan: number,
) {
  return `<rect class="cell ${className}" x="${x}" y="${y}" width="${width}" height="${height}" data-row-start="${rowStart}" data-row-span="${rowSpan}"/>${svgText(label, x + 14, y + 34, width - 28, 'label')}${svgText(contract, x + 14, y + 58, width - 28, 'contract')}`;
}

function svgText(
  value: string,
  x: number,
  y: number,
  width: number,
  className: 'label' | 'contract',
): string {
  const maxCharacters = Math.max(8, Math.floor(width / (className === 'label' ? 9 : 7)));
  const lines = wrapWords(value, maxCharacters).slice(0, 2);
  return `<text class="${className}" x="${x}" y="${y}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : className === 'label' ? 20 : 16}">${escapeXml(line)}</tspan>`,
    )
    .join('')}</text>`;
}

function wrapWords(value: string, maxCharacters: number): string[] {
  const lines: string[] = [];
  for (const word of value.split(/\s+/u)) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maxCharacters) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
