import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function validateDeckReferenceCorpus(corpus) {
  const failures = [];
  if (corpus?.schemaVersion !== 'nodeslide.deck-reference-corpus/v1') {
    failures.push('schemaVersion must be nodeslide.deck-reference-corpus/v1');
  }
  const references = Array.isArray(corpus?.references) ? corpus.references : [];
  const transformations = Array.isArray(corpus?.transformations) ? corpus.transformations : [];
  if (references.length < 20) failures.push('at least 20 references are required');
  if (references.filter((item) => item.domain === 'finance').length < 10) {
    failures.push('at least 10 finance references are required');
  }
  if (references.filter((item) => item.domain === 'research').length < 8) {
    failures.push('at least 8 research references are required');
  }
  const ids = new Set();
  for (const item of references) {
    if (!item?.id || ids.has(item.id))
      failures.push(`reference id is missing or duplicated: ${item?.id}`);
    ids.add(item?.id);
    if (!/^https:\/\//u.test(item?.url ?? ''))
      failures.push(`${item?.id} must use an https source`);
    if (!Array.isArray(item?.patternTags) || item.patternTags.length < 3) {
      failures.push(`${item?.id} needs at least three pattern tags`);
    }
    if (!item?.benchmarkUse) failures.push(`${item?.id} needs an explicit benchmark use`);
  }
  if (transformations.length < 5)
    failures.push('at least five long-to-short transformations are required');
  for (const item of transformations) {
    if ((item?.longDeckSlides?.min ?? 0) < 50 || (item?.longDeckSlides?.max ?? 0) > 100) {
      failures.push(`${item?.id} must exercise a 50-100 slide long deck`);
    }
    if (
      (item?.opportunityMemoSlides?.min ?? 0) < 5 ||
      (item?.opportunityMemoSlides?.max ?? 99) > 8
    ) {
      failures.push(`${item?.id} must compress to a 5-8 slide opportunity memo`);
    }
    if (!Array.isArray(item?.mustRetain) || item.mustRetain.length < 8) {
      failures.push(`${item?.id} needs at least eight must-retain obligations`);
    }
    for (const field of [
      'consequentialClaimsOmitted',
      'unsourcedNumbers',
      'unresolvedContradictionsHidden',
      'requiredSectionsOmitted',
    ]) {
      if (item?.lossBudget?.[field] !== 0)
        failures.push(`${item?.id} lossBudget.${field} must be zero`);
    }
    for (const sourceRef of item?.sourceRefs ?? []) {
      if (!ids.has(sourceRef)) failures.push(`${item?.id} references unknown source ${sourceRef}`);
    }
  }
  return failures;
}

async function main() {
  const corpusUrl = new URL(
    '../benchmarks/deck-reference-corpus/v1/references.json',
    import.meta.url,
  );
  const corpus = JSON.parse(await readFile(corpusUrl, 'utf8'));
  const failures = validateDeckReferenceCorpus(corpus);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log(
    `Deck reference corpus valid: ${corpus.references.length} references, ${corpus.transformations.length} long-to-short transformations.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
