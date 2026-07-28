/**
 * Emit the Atlas showcase-receipt projection.
 *
 * parity-studio's Atlas contract layer has an `earnedAtlasMaturity` ladder that had never scored a
 * single real receipt: its registry held archetypes and source policies but zero recipes and zero
 * receipts, so the maturity gate was a contract with nothing to grade. Meanwhile this repo already
 * holds 84 committed receipts from the 2026-07-22 arena run — 72 model candidates with paid
 * telemetry and 12 deterministic baselines.
 *
 * The gap was never a missing run. It was a missing projection, and it closes with zero model
 * calls. This is the producer side, following the same nodeslide -> parity flow as
 * emit-arena-contracts.mjs: nodeslide owns the data, parity consumes a generated file rather than
 * minting a second schema.
 *
 * What this deliberately does NOT do: invent a maturity. Every recipe is emitted with the receipts
 * it owns and nothing else. parity computes the maturity from those receipts with its own ladder,
 * so a claim can still disagree with what the evidence earns — which is the entire point of having
 * the ladder.
 *
 * The one field a run cannot produce is `humanPreferred`. `certified` needs a person, and this
 * merges their answer from contracts/atlas-human-preference.json when one exists. Three states are
 * kept apart on purpose — not declared, declared and empty, declared and merged — because a review
 * that happened and evaporated with no error anywhere is the failure this file is most able to
 * cause.
 *
 * Usage: node scripts/emit-atlas-receipts.mjs [--check] [--preference <path>]
 *   --check       exit 1 if the on-disk projection differs from what would be emitted (CI drift gate)
 *   --preference  read the human preference file from here; missing at this path is an error
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPE_BY_ARTIFACT_TYPE } from './build-atlas-v3-native.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptsPath = path.join(rootDirectory, 'artifacts/deck-gym/artifact-atlas-v1/receipts.json');
const outputPath = path.join(rootDirectory, 'contracts/atlas-receipts.json');
const preferencePath = path.join(rootDirectory, 'contracts/atlas-human-preference.json');

/**
 * The arena's 12 fixtures predate the v2 deck's 38 and use their own names, so
 * ARCHETYPE_BY_ARTIFACT_TYPE (keyed on deck vocabulary) covers only half the receipts. These are
 * the remaining six, mapped by what the fixture actually produces. Kept here rather than merged
 * into the deck's map: that map answers "what does this SLIDE compile to", and conflating the two
 * vocabularies is how a wrong archetype would silently grade the wrong receipts.
 */
const ARCHETYPE_BY_ARENA_FIXTURE = {
  'architecture-diagram': 'systems.architecture',
  'sequence-diagram': 'systems.sequence',
  'multi-series-chart': 'data.multi-series',
  'katex-equation': 'technical.equation',
  'screenshot-callouts': 'product-evidence.screenshot-callouts',
  timeline: 'progression.timeline',
};

const archetypeFor = (artifactType) =>
  ARCHETYPE_BY_ARTIFACT_TYPE[artifactType] ?? ARCHETYPE_BY_ARENA_FIXTURE[artifactType] ?? null;

const PROJECTION_VERSION = 'nodeslide.atlas-receipt-projection/v1';
const RECEIPT_SCHEMA = 'nodeslide.atlas-showcase-receipt/v1';
const ATLAS_SCHEMA = 'nodeslide.atlas/v1';

/** Sorted-key stringify so the drift check compares content, not key order. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The commit that last touched the RECEIPTS, not whatever HEAD happens to be.
 *
 * Reading HEAD makes the projection non-reproducible: every unrelated commit changes the emitted
 * bytes, so `--check` fails on any commit that did not touch the source data, and two copies of
 * the same projection disagree purely because they were generated at different times. The identity
 * that matters is the data's, so this asks git when the data last changed.
 */
function sourceCommit() {
  try {
    const commit = execFileSync(
      'git',
      [
        'log',
        '-1',
        '--format=%H',
        '--',
        path.relative(rootDirectory, receiptsPath),
        // The preference file is source data too once it exists. Without it here, a commit that
        // changed only the human verdict would leave the projection pointing at the old receipts
        // commit, so its provenance would no longer identify the data it contains.
        path.relative(rootDirectory, preferencePath),
      ],
      { cwd: rootDirectory, encoding: 'utf8' },
    ).trim();
    return commit.length > 0 ? commit : null;
  } catch {
    return null;
  }
}

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');
const sameIdSet = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);

const GATE_FLAGS = ['briefAdherence', 'visualPassed', 'evidencePassed', 'exportPassed'];

/**
 * A projected receipt a human preference could ever move. Mirrors parity's `poolExclusionReason`.
 *
 * `certified` needs a gate-passing MODEL receipt, so a `true` anywhere else changes no rung — and
 * that is worse than a crash, because the projection then reads as a human endorsement that nothing
 * downstream reflects.
 */
function preferenceIneligibility(receipt) {
  if (receipt.candidateKind !== 'model') return 'not-a-model-candidate';
  if (receipt.status !== 'eligible') return `status-${receipt.status}`;
  const failed = GATE_FLAGS.filter((flag) => receipt.evaluation?.[flag] !== true);
  return failed.length > 0 ? `gate-failed-${failed.join('+')}` : null;
}

/**
 * Everything wrong with a preference file that can be seen WITHOUT the run's receipts.
 *
 * This used to ask for a schema string and two arrays, which is five lines anyone can type — and
 * that file certified a recipe end to end. The producer's own strict validator never ran here; it
 * only ever saw the object its author had just constructed, which cannot contradict its author.
 *
 * So the verdict is re-derived rather than read. `evidence` carries the head-to-head record per
 * cell, the whole tournament is rebuilt from it, and `preferred` / `notPreferred` are recomputed
 * under the fold rule. A forger now has to supply an internally consistent tournament that lands on
 * the answer they want — a description of a review, not an assertion that one happened.
 */
function preferenceShapeProblems(parsed, label) {
  const problems = [];
  const say = (message) => problems.push(`Human preference file ${label} ${message}`);
  if (!isPlainObject(parsed)) return [`Human preference file ${label} is not an object.`];
  if (parsed.schemaVersion !== 'nodeslide.atlas-human-preference/v1') {
    say(`carries schema ${String(parsed.schemaVersion)}.`);
  }
  for (const field of ['scheduleDigest', 'seedFingerprint']) {
    if (typeof parsed[field] !== 'string' || parsed[field].length === 0) {
      say(`carries no ${field}, so it is not bound to any blind review that ever ran.`);
    }
  }
  if (!Number.isInteger(parsed.cropHeight)) {
    say('carries no integer cropHeight, so the judged artifact is unbounded.');
  }
  if (typeof parsed.reviewedAt !== 'number') say('carries no reviewedAt.');
  if (!isStringArray(parsed.preferred)) say('has no `preferred` array of receipt ids.');
  if (!isStringArray(parsed.notPreferred)) say('has no `notPreferred` array of receipt ids.');
  const notJudged = Array.isArray(parsed.notJudged) ? parsed.notJudged : null;
  if (!notJudged) {
    say('has no `notJudged` array; a file that abstains silently reads as an oversight.');
  } else if (
    notJudged.some(
      (entry) =>
        !isPlainObject(entry) ||
        typeof entry.receiptId !== 'string' ||
        typeof entry.reason !== 'string' ||
        entry.reason.length === 0,
    )
  ) {
    say('has a notJudged entry with no receiptId or no reason.');
  }
  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : null;
  if (!evidence) {
    say(
      'has no `evidence` array; without the head-to-head record the verdict cannot be re-derived and has to be taken on trust.',
    );
  } else if (
    evidence.some(
      (row) =>
        !isPlainObject(row) ||
        typeof row.receiptId !== 'string' ||
        typeof row.cellKey !== 'string' ||
        !['wins', 'losses', 'undecidedPairs', 'opponentCount', 'cellSize'].every((key) =>
          Number.isInteger(row[key]),
        ),
    )
  ) {
    say(
      'has an evidence row missing receiptId, cellKey or integer wins/losses/undecidedPairs/opponentCount/cellSize.',
    );
  }
  if (!Array.isArray(parsed.renderBindings)) {
    say(
      'has no `renderBindings` array; without it the file names receipt ids and nothing about the pixels that were on screen.',
    );
  } else if (
    parsed.renderBindings.some(
      (entry) =>
        !isPlainObject(entry) ||
        typeof entry.receiptId !== 'string' ||
        typeof entry.renderSha256 !== 'string' ||
        entry.renderSha256.length === 0,
    )
  ) {
    say('has a renderBindings entry with no receiptId or no renderSha256.');
  }
  if (!isStringArray(parsed.preferred) || !isStringArray(parsed.notPreferred) || !evidence) {
    return problems;
  }

  const overlap = parsed.preferred.filter((id) => parsed.notPreferred.includes(id));
  if (overlap.length > 0) say(`both prefers and rejects: ${overlap.join(', ')}.`);

  const totalWins = evidence.reduce((sum, row) => sum + row.wins, 0);
  const totalLosses = evidence.reduce((sum, row) => sum + row.losses, 0);
  if (totalWins !== totalLosses) {
    say(
      `records ${totalWins} wins against ${totalLosses} losses; every decided pair produces exactly one of each.`,
    );
  }
  const byCell = new Map();
  for (const row of evidence) {
    if (row.cellSize < 2) say(`gives ${row.receiptId} a cell of ${row.cellSize}.`);
    if (row.opponentCount !== row.cellSize - 1) {
      say(`gives ${row.receiptId} ${row.opponentCount} opponents in a cell of ${row.cellSize}.`);
    }
    if (row.wins + row.losses + row.undecidedPairs !== row.opponentCount) {
      say(
        `records ${row.receiptId} as ${row.wins}W/${row.losses}L/${row.undecidedPairs} undecided against ${row.opponentCount} opponents.`,
      );
    }
    if (!byCell.has(row.cellKey)) byCell.set(row.cellKey, []);
    byCell.get(row.cellKey).push(row);
  }
  const undecidedByCell = new Map();
  for (const [cellKey, members] of byCell) {
    const cellSize = members[0].cellSize;
    if (members.some((row) => row.cellSize !== cellSize)) {
      say(`reports more than one size for cell ${cellKey}.`);
      continue;
    }
    if (members.length !== cellSize) {
      say(`lists ${members.length} receipts in cell ${cellKey} but claims a size of ${cellSize}.`);
      continue;
    }
    const decided = members.reduce((sum, row) => sum + row.wins, 0);
    const undecidedSlots = members.reduce((sum, row) => sum + row.undecidedPairs, 0);
    if (undecidedSlots % 2 !== 0) {
      say(`reports an odd number of undecided pair slots in cell ${cellKey}.`);
      continue;
    }
    const undecided = undecidedSlots / 2;
    const pairsInCell = (cellSize * (cellSize - 1)) / 2;
    if (decided + undecided !== pairsInCell) {
      say(`accounts for ${decided + undecided} of the ${pairsInCell} pairs in cell ${cellKey}.`);
      continue;
    }
    undecidedByCell.set(cellKey, undecided);
  }

  const derivedNotPreferred = evidence
    .filter((row) => row.losses > 0)
    .map((row) => row.receiptId)
    .sort();
  if (!sameIdSet(derivedNotPreferred, [...parsed.notPreferred].sort())) {
    say(
      `names ${parsed.notPreferred.length} rejected receipts while its own evidence records ${derivedNotPreferred.length} losses.`,
    );
  }
  const derivedPreferred = evidence
    .filter(
      (row) =>
        row.losses === 0 &&
        row.wins > 0 &&
        row.undecidedPairs === 0 &&
        (undecidedByCell.get(row.cellKey) ?? Number.POSITIVE_INFINITY) === 0,
    )
    .map((row) => row.receiptId)
    .sort();
  if (!sameIdSet(derivedPreferred, [...parsed.preferred].sort())) {
    say(
      `names ${parsed.preferred.length} preferred receipts [${[...parsed.preferred].sort().slice(0, 3).join(', ')}] while undefeated-in-a-fully-decided-cell names ${derivedPreferred.length} [${derivedPreferred.slice(0, 3).join(', ')}].`,
    );
  }

  const bound = new Set((parsed.renderBindings ?? []).map((entry) => entry?.receiptId));
  for (const id of [...parsed.preferred, ...parsed.notPreferred]) {
    if (!bound.has(id)) say(`carries a preference on ${id} but no render binding for it.`);
  }
  return problems;
}

/**
 * The half that needs this run's receipts: is every named id one a preference could move, and does
 * the file account for all of them?
 *
 * Resolved against the receipts, never against anything the file says about itself. A file that
 * names one id and stops is indistinguishable from a hand-typed one, which is the point.
 */
function preferenceRunProblems(parsed, receipts, label) {
  const problems = [];
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  for (const id of [...parsed.preferred, ...parsed.notPreferred]) {
    const receipt = byId.get(id);
    if (!receipt) {
      problems.push(`Human preference file ${label} names ${id}, which is not in this run.`);
      continue;
    }
    const reason = preferenceIneligibility(receipt);
    if (reason) {
      problems.push(
        `Human preference file ${label} records a preference on ${id}, which is not a gate-passing model candidate (${reason}); it would change no rung and read as an endorsement nothing reflects.`,
      );
    }
  }
  const named = new Set([
    ...parsed.preferred,
    ...parsed.notPreferred,
    ...(parsed.notJudged ?? []).map((entry) => entry?.receiptId),
  ]);
  const unaccounted = receipts.map((receipt) => receipt.id).filter((id) => !named.has(id));
  if (unaccounted.length > 0) {
    problems.push(
      `Human preference file ${label} names ${unaccounted.length} of ${receipts.length} receipts nowhere (first: ${unaccounted.slice(0, 3).join(', ')}). A file that does not account for every receipt cannot be told apart from one somebody typed.`,
    );
  }
  return problems;
}

/**
 * Load the human verdict, keeping "nobody reviewed" apart from "a review preferred nothing".
 *
 * Declared-but-unreadable throws rather than falling back to null: a wrong path, a bad cwd or a
 * truncated file would otherwise re-emit 84 nulls, every downstream surface would go on saying no
 * review has run, and the ten minutes a person spent would vanish with no error anywhere.
 *
 * Declared-but-unprovable now throws for the same reason in the other direction: a file that cannot
 * describe the review it claims must not be able to set `humanPreferred` on anything.
 */
async function loadHumanPreference(declaredPath) {
  const target = declaredPath ? path.resolve(rootDirectory, declaredPath) : preferencePath;
  let raw;
  try {
    raw = await readFile(target, 'utf8');
  } catch (error) {
    if (declaredPath || error.code !== 'ENOENT') {
      throw new Error(`Declared human preference file ${target} is unreadable: ${error.message}`);
    }
    return {
      state: 'absent',
      file: null,
      parsed: null,
      preferred: new Set(),
      notPreferred: new Set(),
      scheduleDigest: null,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Human preference file ${target} is not valid JSON: ${error.message}`);
  }
  const problems = preferenceShapeProblems(parsed, target);
  if (problems.length > 0) {
    throw new Error(`Refusing to merge a preference file that cannot describe its own review:
  ${problems.join('\n  ')}`);
  }
  return {
    state: 'declared',
    file: path.relative(rootDirectory, target).replace(/\\/g, '/'),
    parsed,
    preferred: new Set(parsed.preferred),
    notPreferred: new Set(parsed.notPreferred),
    scheduleDigest: parsed.scheduleDigest,
  };
}

/**
 * Translate one arena receipt into the shape parity's contract declares.
 *
 * `candidateKind` passes through untouched and carries the weight here: parity's ladder refuses to
 * award `proven` to a deterministic baseline, because a baseline is this repo's own compiler
 * replaying the fixture the gates were written against.
 */
function projectReceipt(receipt, recipeId, preference) {
  const evaluation = receipt.evaluation ?? {};
  const outputs = receipt.outputs ?? {};
  return {
    schemaVersion: RECEIPT_SCHEMA,
    id: receipt.candidateId,
    recipeId,
    recipeVersion: receipt.harnessVersion ?? 'artifact-arena-v1',
    archetypeId: archetypeFor(receipt.artifactType),
    model: { id: receipt.model, role: receipt.modelRole ?? 'unknown' },
    candidateKind: receipt.candidateKind,
    harnessVersion: receipt.harnessVersion ?? 'artifact-arena-v1',
    sourceIds: receipt.sourceIds ?? [],
    referenceIds: receipt.referenceIds ?? [],
    editability: receipt.editability ?? { web: 'unsupported', pptx: 'unsupported' },
    evaluation: {
      briefAdherence: evaluation.briefAdherence ?? null,
      visualPassed: evaluation.visualPassed ?? null,
      evidencePassed: evaluation.evidencePassed ?? null,
      exportPassed: evaluation.exportPassed ?? null,
      repairCount: evaluation.repairCount ?? 0,
    },
    outputs: {
      browserRenderRef: outputs.browserRender ?? '',
      pptxRenderRef: outputs.pptxRender ?? '',
      pptxFileRef: outputs.pptxFile ?? '',
    },
    costUsd: (evaluation.costMicroUsd ?? 0) / 1_000_000,
    latencyMs: evaluation.generationMs ?? 0,
    // Never invented, and now conditional for exactly the reason it was hardcoded: `certified`
    // requires a human blind review, and defaulting this to `true` is the cheapest way to fake the
    // top of the ladder. It becomes `true` or `false` only where a named receipt appears in a
    // verdict a person actually recorded. Everything else stays `null` — a tie, a skip, an
    // unfinished cell and a receipt nobody was shown are all "not judged", and coercing any of them
    // to `false` would claim a person looked and said no.
    humanPreferred: preference.preferred.has(receipt.candidateId)
      ? true
      : preference.notPreferred.has(receipt.candidateId)
        ? false
        : null,
    producedAt: Date.parse(receipt.generatedAt ?? '') || 0,
    status: receipt.status ?? 'unknown',
  };
}

async function buildProjection(preference) {
  const raw = JSON.parse(await readFile(receiptsPath, 'utf8'));
  const all = Array.isArray(raw) ? raw : (raw.receipts ?? []);

  const byArtifactType = new Map();
  for (const receipt of all) {
    if (!byArtifactType.has(receipt.artifactType)) byArtifactType.set(receipt.artifactType, []);
    byArtifactType.get(receipt.artifactType).push(receipt);
  }

  const recipes = [];
  const receipts = [];
  const unmapped = [];
  for (const [artifactType, group] of [...byArtifactType].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const archetypeId = archetypeFor(artifactType);
    if (!archetypeId) {
      // An artifactType with no archetype cannot be graded, and silently dropping it would make
      // the projection look more complete than it is.
      unmapped.push(artifactType);
      continue;
    }
    const recipeId = `nodeslide.arena.${artifactType}`;
    const owned = group.map((receipt) => projectReceipt(receipt, recipeId, preference));
    receipts.push(...owned);
    recipes.push({
      schemaVersion: ATLAS_SCHEMA,
      id: recipeId,
      artifactType,
      archetypeId,
      narrativeJob: group[0].narrativeJob ?? '',
      receiptIds: owned.map((receipt) => receipt.id),
      modelReceiptCount: owned.filter((receipt) => receipt.candidateKind === 'model').length,
      baselineReceiptCount: owned.filter(
        (receipt) => receipt.candidateKind === 'deterministic-baseline',
      ).length,
      // No `maturity` field on purpose: parity derives it from these receipts. A maturity written
      // here would be a claim travelling alongside its own evidence, which is what the ladder is
      // supposed to be able to contradict.
    });
  }

  return {
    schemaVersion: PROJECTION_VERSION,
    sourceRepository: 'nodeslide',
    receiptSchema: RECEIPT_SCHEMA,
    runId: 'artifact-atlas-v1',
    totals: {
      receipts: receipts.length,
      recipes: recipes.length,
      modelReceipts: receipts.filter((receipt) => receipt.candidateKind === 'model').length,
      baselineReceipts: receipts.filter(
        (receipt) => receipt.candidateKind === 'deterministic-baseline',
      ).length,
      unmappedArtifactTypes: unmapped.sort(),
    },
    recipes,
    receipts,
    meta: {
      sourceFile: path.relative(rootDirectory, receiptsPath).replace(/\\/g, '/'),
      sourceCommit: sourceCommit(),
      // Carried only once a verdict exists, so a projection emitted before any review is byte-for
      // byte what it was and `--check` stays a real drift gate rather than a rebase chore.
      ...(preference.state === 'declared'
        ? {
            humanPreferenceFile: preference.file,
            humanPreferenceScheduleDigest: preference.scheduleDigest,
          }
        : {}),
    },
  };
}

/** `--preference <path>` without swallowing a following flag as the value. */
function preferenceFlag(argv) {
  const index = argv.indexOf('--preference');
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--preference needs a path.');
  }
  return value;
}

async function main() {
  const preference = await loadHumanPreference(preferenceFlag(process.argv));
  const projection = await buildProjection(preference);
  const mergedCount = projection.receipts.filter(
    (receipt) => receipt.humanPreferred !== null,
  ).length;
  const knownIds = new Set(projection.receipts.map((receipt) => receipt.id));
  const strays = [...preference.preferred, ...preference.notPreferred].filter(
    (id) => !knownIds.has(id),
  );
  if (strays.length > 0) {
    // A preference naming a receipt this run does not contain means the verdict answers a
    // different run. Dropping it silently would leave a human's answer half-applied.
    process.stderr.write(
      `Human preference file names receipts that are not in this run:\n  ${strays.join('\n  ')}\n`,
    );
    process.exit(1);
  }
  if (preference.state === 'declared') {
    // The half of the gate that needs the run: eligibility and completeness, resolved against these
    // receipts rather than against anything the file asserts. Nothing is written until it passes.
    const runProblems = preferenceRunProblems(
      preference.parsed,
      projection.receipts,
      preference.file,
    );
    if (runProblems.length > 0) {
      process.stderr.write(`${runProblems.join('\n')}\n`);
      process.exit(1);
    }
  }
  const preferenceLine =
    preference.state === 'absent'
      ? '  human preference: not declared (no contracts/atlas-human-preference.json)'
      : `  human preference: declared ${preference.file}, ${mergedCount} of ${projection.receipts.length} receipts merged`;
  // Hash the DATA only — meta is excluded entirely, not just its own sha256 field. A digest that
  // covered `meta` would fold provenance bookkeeping into the content identity, so two byte-equal
  // projections could disagree about their own hash.
  const { meta: _meta, ...body } = projection;
  projection.meta.sha256 = `sha256:${createHash('sha256')
    .update(stableStringify(body))
    .digest('hex')}`;
  const serialized = `${JSON.stringify(projection, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    let existing = null;
    try {
      existing = await readFile(outputPath, 'utf8');
    } catch {
      process.stderr.write(
        'Atlas receipt projection is missing. Run: node scripts/emit-atlas-receipts.mjs\n',
      );
      process.exit(1);
    }
    if (stableStringify(JSON.parse(existing)) !== stableStringify(projection)) {
      // The preference state goes out on the failure path too. "Declared, 0 merged" and "not
      // declared" are different reasons for the same stale file and must not read the same.
      process.stderr.write(
        `Atlas receipt projection is stale. Regenerate: node scripts/emit-atlas-receipts.mjs\n${preferenceLine}\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`Atlas receipt projection is up to date.\n${preferenceLine}\n`);
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');
  const { totals } = projection;
  const ungraded =
    totals.unmappedArtifactTypes.length > 0
      ? `\n  ungraded artifactTypes (no archetype mapping): ${totals.unmappedArtifactTypes.join(', ')}`
      : '';
  process.stdout.write(
    `Wrote ${path.relative(rootDirectory, outputPath)}: ${totals.receipts} receipts (${totals.modelReceipts} model, ${totals.baselineReceipts} baseline) across ${totals.recipes} recipes.${ungraded}\n${preferenceLine}\n`,
  );
}

try {
  await main();
} catch (error) {
  // Exit 1 with the reason on stderr. A declared preference file that cannot be read must never
  // degrade into a quiet re-emit of 84 nulls.
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
