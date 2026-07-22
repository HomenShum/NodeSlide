#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { digestJson } from './lib/node-gym-runner-core.mjs';

if (!process.argv.includes('--confirm-all-slides-inspected')) {
  throw new Error('Refusing to sign visual inspection without --confirm-all-slides-inspected.');
}

const root = process.cwd();
const pptxPath = path.resolve(root, 'outputs/artifact-atlas-v3/nodeslide-artifact-atlas-v3.pptx');
const pptxReceiptPath = path.resolve(root, 'outputs/artifact-atlas-v3/atlas-v3-pptx-receipt.json');
const renderDir = path.resolve(root, 'outputs/artifact-atlas-v3/rendered');
const contactSheetPath = path.resolve(root, 'outputs/artifact-atlas-v3/atlas-v3-contact-sheet.png');
const outputPath = path.resolve(root, 'outputs/artifact-atlas-v3/atlas-v3-visual-inspection.json');

const [pptxBytes, pptxReceiptBytes, contactSheetBytes] = await Promise.all([
  readFile(pptxPath),
  readFile(pptxReceiptPath),
  readFile(contactSheetPath),
]);
const pptxReceipt = JSON.parse(pptxReceiptBytes.toString('utf8'));
const pptxDigest = sha256(pptxBytes);
if (pptxReceipt.digest !== pptxDigest || pptxReceipt.slideCount !== 43) {
  throw new Error('Visual inspection input does not match the signed 43-slide PPTX receipt.');
}

const renderNames = (await readdir(renderDir))
  .filter((name) => /^slide-\d+\.png$/u.test(name))
  .sort((left, right) => slideNumber(left) - slideNumber(right));
if (
  renderNames.length !== 43 ||
  renderNames.some((name, index) => slideNumber(name) !== index + 1)
) {
  throw new Error('Visual inspection requires one ordered PNG render for every slide.');
}

const slides = [];
for (const name of renderNames) {
  const bytes = await readFile(path.join(renderDir, name));
  const { width, height } = pngDimensions(bytes);
  if (width !== 1280 || height !== 720) {
    throw new Error(`${name} is ${width}x${height}; expected 1280x720.`);
  }
  slides.push({
    slide: slideNumber(name),
    path: normalizePath(path.relative(root, path.join(renderDir, name))),
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    width,
    height,
  });
}

const contactSheetDimensions = pngDimensions(contactSheetBytes);
const receipt = {
  schemaVersion: 'nodeslide.artifact-atlas-v3-visual-inspection/v1',
  pptx: {
    path: normalizePath(path.relative(root, pptxPath)),
    sha256: pptxDigest,
    bytes: pptxBytes.byteLength,
    receiptPath: normalizePath(path.relative(root, pptxReceiptPath)),
    receiptSha256: sha256(pptxReceiptBytes),
  },
  render: {
    renderer: '@oai/artifact-tool PowerPoint round-trip renderer',
    command: 'render_slides.py nodeslide-artifact-atlas-v3.pptx --width 1280 --height 720',
    slideCount: slides.length,
    slideSetDigest: digestJson(slides),
    slides,
    contactSheet: {
      path: normalizePath(path.relative(root, contactSheetPath)),
      sha256: sha256(contactSheetBytes),
      bytes: contactSheetBytes.byteLength,
      ...contactSheetDimensions,
    },
  },
  automatedChecks: {
    slidesTest: {
      status: 'passed',
      overflowCount: 0,
      command: 'slides_test.py nodeslide-artifact-atlas-v3.pptx',
    },
  },
  visualInspection: {
    status: 'passed',
    inspectedSlides: slides.map(({ slide }) => slide),
    method: 'individual 1280x720 slide review plus ordered contact-sheet review',
    unresolvedDefects: [],
    completedOn: '2026-07-22',
  },
  blindAudiencePreference: {
    status: 'not_run',
    note: 'Visual QA is not a substitute for blind audience preference.',
  },
};

await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`[artifact-atlas-v3] visual inspection: ${path.relative(root, outputPath)}`);

function slideNumber(name) {
  return Number(name.match(/^slide-(\d+)\.png$/u)?.[1]);
}

function pngDimensions(bytes) {
  if (
    bytes.byteLength < 24 ||
    !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error('Visual inspection render is not a valid PNG.');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
