import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  renderRecipeHtml,
  renderRecipeSvg,
  verifyRecipeGridAlignment,
} from '../packages/recipelang/dist/index.js';

const sourcePath = resolve('packages/recipelang/reference/edge-data-contract.recipe.yaml');
const htmlPath = resolve('public/recipelang/edge-data-contract.html');
const svgPath = resolve('public/recipelang/edge-data-contract.svg');
const receiptPath = resolve('public/recipelang/edge-data-contract.receipt.json');
const source = parse(await readFile(sourcePath, 'utf8'));
const html = `${renderRecipeHtml(source).content}\n`;
const svg = `${renderRecipeSvg(source).content}\n`;
const alignment = verifyRecipeGridAlignment(source);
if (!alignment.passed) {
  throw new Error(`RecipeLang alignment failed: ${alignment.issues.join(' ')}`);
}
const receipt = `${JSON.stringify(
  {
    schemaVersion: 'recipelang.reference/v1',
    source: 'packages/recipelang/reference/edge-data-contract.recipe.yaml',
    htmlSha256: sha256(html),
    svgSha256: sha256(svg),
    alignment,
  },
  null,
  2,
)}\n`;
const files = [
  [htmlPath, html],
  [svgPath, svg],
  [receiptPath, receipt],
];

if (process.argv.includes('--check')) {
  const mismatches = [];
  for (const [path, expected] of files) {
    const actual = await readFile(path, 'utf8').catch(() => '');
    if (actual !== expected) mismatches.push(path);
  }
  if (mismatches.length) {
    throw new Error(`RecipeLang reference artifacts are stale: ${mismatches.join(', ')}`);
  }
} else {
  for (const [path, content] of files) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    mode: process.argv.includes('--check') ? 'check' : 'write',
    html: htmlPath,
    svg: svgPath,
    alignment,
  })}\n`,
);

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
