#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { parse } from 'yaml';
import {
  applyRecipePatch,
  canonicalJson,
  compileRecipe,
  recipeHash,
  renderRecipeHtml,
  renderRecipeSvg,
  verifyRecipeGridAlignment,
} from './index';
import type { RecipePatch, RecipeSnapshot } from './types';

const [command, ...raw] = process.argv.slice(2);

try {
  if (!command || command === 'help' || command === '--help') usage();
  else if (command === 'validate') {
    const { positionals, flags } = args(raw);
    const compiled = compileRecipe(await load(positionals[0]));
    emit(
      {
        ok: compiled.receipt.contractErrors === 0,
        receipt: compiled.receipt,
      },
      flags,
    );
    if (compiled.receipt.contractErrors) process.exitCode = 2;
  } else if (command === 'compile') {
    const { positionals, flags } = args(raw);
    const compiled = compileRecipe(await load(positionals[0]));
    if (compiled.receipt.contractErrors) {
      emit({ ok: false, receipt: compiled.receipt }, flags);
      process.exitCode = 2;
    } else await output(canonicalJson(compiled.snapshot), flags);
  } else if (command === 'render') {
    const { positionals, flags } = args(raw);
    const source = await load(positionals[0]);
    const format = value(flags, 'format') ?? 'svg';
    const rendered = format === 'html' ? renderRecipeHtml(source) : renderRecipeSvg(source);
    if (rendered.compiled.receipt.contractErrors) {
      emit({ ok: false, receipt: rendered.compiled.receipt }, flags);
      process.exitCode = 2;
    } else await output(rendered.content, flags);
  } else if (command === 'verify-alignment') {
    const { positionals, flags } = args(raw);
    const alignment = verifyRecipeGridAlignment(await load(positionals[0]));
    emit({ ok: alignment.passed, alignment }, flags);
    if (!alignment.passed) process.exitCode = 2;
  } else if (command === 'inspect') {
    const { positionals, flags } = args(raw);
    const compiled = compileRecipe(await load(positionals[0]));
    const artifactId = required(flags, 'artifact');
    const artifact = compiled.artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new Error(`Unknown artifact ${artifactId}.`);
    emit({ artifact, receipt: compiled.receipt }, flags);
  } else if (command === 'diff') {
    const { positionals, flags } = args(raw);
    const before = compileRecipe(await load(positionals[0])).snapshot;
    const after = compileRecipe(await load(positionals[1])).snapshot;
    emit(
      {
        beforeHash: recipeHash(before),
        afterHash: recipeHash(after),
        changed: recipeHash(before) !== recipeHash(after),
        entities: entityDiff(before, after),
      },
      flags,
    );
  } else if (command === 'patch') {
    const { positionals, flags } = args(raw);
    const snapshot = compileRecipe(await load(positionals[0])).snapshot;
    const patch = (await load('-')) as RecipePatch;
    const expected = Number(required(flags, 'base-version'));
    if (patch.baseVersion !== expected) {
      throw new Error(
        `Patch baseVersion ${patch.baseVersion} does not match --base-version ${expected}.`,
      );
    }
    const applied = applyRecipePatch(snapshot, patch);
    const target = value(flags, 'out');
    if (target) await writeOutputFile(target, `${canonicalJson(applied.snapshot)}\n`);
    emit(applied, flags);
  } else {
    throw new Error(`Unknown RecipeLang command ${command}.`);
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = process.exitCode || 1;
}

function args(values: string[]) {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index] as string;
    if (!token.startsWith('--')) positionals.push(token);
    else {
      const key = token.slice(2);
      const next = values[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(key, next);
        index += 1;
      } else flags.set(key, true);
    }
  }
  return { positionals, flags };
}

async function load(path: string | undefined): Promise<unknown> {
  if (!path) throw new Error('A recipe path or - for stdin is required.');
  const text = path === '-' ? await readStdin() : await readFile(resolve(path), 'utf8');
  return parse(text);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function output(content: string, flags: Map<string, string | true>) {
  const target = value(flags, 'out');
  if (target) await writeOutputFile(target, `${content}\n`);
  else stdout.write(`${content}\n`);
}

async function writeOutputFile(target: string, content: string) {
  const absolute = resolve(target);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, { encoding: 'utf8', flag: 'w' });
}

function emit(valueToWrite: unknown, flags: Map<string, string | true>) {
  const pretty = flags.get('json') === true;
  stdout.write(`${JSON.stringify(valueToWrite, null, pretty ? 2 : undefined)}\n`);
}

function value(flags: Map<string, string | true>, key: string): string | undefined {
  const candidate = flags.get(key);
  return typeof candidate === 'string' ? candidate : undefined;
}

function required(flags: Map<string, string | true>, key: string): string {
  const candidate = value(flags, key);
  if (!candidate) throw new Error(`--${key} is required.`);
  return candidate;
}

function entityDiff(before: RecipeSnapshot, after: RecipeSnapshot) {
  const beforeIds = new Set(entityIds(before));
  const afterIds = new Set(entityIds(after));
  return {
    added: [...afterIds].filter((id) => !beforeIds.has(id)).sort(),
    removed: [...beforeIds].filter((id) => !afterIds.has(id)).sort(),
  };
}

function entityIds(snapshot: RecipeSnapshot): string[] {
  return [
    ...snapshot.inputs.map((item) => item.id),
    ...snapshot.artifacts.map((item) => item.id),
    ...snapshot.steps.map((item) => item.id),
    ...(snapshot.notes ?? []).map((item) => item.id),
  ];
}

function usage() {
  stdout.write(`RecipeLang deterministic compiler
recipelang validate <recipe.yaml|json|-> [--json]
recipelang compile <recipe.yaml|json|-> [--out recipe.json]
recipelang render <recipe.yaml|json|-> [--format svg|html] [--out artifact]
recipelang verify-alignment <recipe.yaml|json|-> [--json]
recipelang inspect <recipe> --artifact <id> [--json]
recipelang diff <before> <after> [--json]
recipelang patch <recipe> --base-version <n> [--out recipe.json] [--json] < patch.json
`);
}
