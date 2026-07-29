import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_DERIVED_ERASURE_TABLES,
  NODESLIDE_ERASURE_EXCLUSIONS,
  type NodeSlideSchemaLike,
  buildNodeSlideErasureContract,
} from './lib/nodeslideErasureContract';
import schema from './schema';

/**
 * Scenario: an author deletes a deck that was built by the durable job runner.
 * The schema-derived erasure scan sweeps every table with a `deckId` column and
 * returns a green receipt. Meanwhile the job row, the durable session, its event
 * chain, its model-result replay payloads, and the spend ledger all survive —
 * none of them has a `deckId`, so none of them was ever in the scan's list.
 *
 * The contract's own rule (`convex/lib/nodeslideErasureContract.ts`) makes an
 * unclassifiable table throw, which is why these eight are excluded explicitly.
 * But an exclusion is exactly where that protection stops. From the contract's
 * point of view "excluded because it is infrastructure" and "excluded because
 * something else deletes it" are the same shape, and only the second one has a
 * second half that can silently go missing.
 *
 * These tests are that second half. They hold the pairing between the
 * `derived_scope` exclusions and the sweep in `nodeslideRetention.ts`, and they
 * fail if either side moves without the other.
 */

const convexDirectory = path.dirname(fileURLToPath(import.meta.url));
const retentionSource = readFileSync(path.join(convexDirectory, 'nodeslideRetention.ts'), 'utf8');

const derivedExclusions = NODESLIDE_ERASURE_EXCLUSIONS.filter(
  (exclusion) => exclusion.reason === 'derived_scope',
);

describe('nodeslide derived-scope erasure', () => {
  it('still builds a contract over the schema with the job tables added', () => {
    // The contract throws at module load on any table it cannot place. Eight new
    // tables landed with this port; if any of them were left unclassified, this
    // is where the whole backend stops importing.
    expect(() =>
      buildNodeSlideErasureContract(schema as unknown as NodeSlideSchemaLike),
    ).not.toThrow();
  });

  it('pairs every derived_scope exclusion with the declared sweep list', () => {
    expect([...derivedExclusions].map((exclusion) => exclusion.table).sort()).toEqual(
      [...NODESLIDE_DERIVED_ERASURE_TABLES].sort(),
    );
  });

  it.each(NODESLIDE_DERIVED_ERASURE_TABLES)('sweeps %s in nodeslideRetention.ts', (table) => {
    // A source-level check on purpose. The alternative — asserting on delete
    // counts against a fake database — passes just as well when the traversal
    // queries the right table with the wrong index, and it cannot notice a table
    // that was never queried at all.
    expect(retentionSource, `nodeslideRetention.ts never queries ${table}`).toContain(
      `.query('${table}')`,
    );
  });

  it.each(NODESLIDE_DERIVED_ERASURE_TABLES)(
    '%s exists in the schema and genuinely has no deck scope',
    (table) => {
      // If somebody later gives one of these a required `deckId`, it becomes
      // scannable and should be classified normally rather than swept by hand.
      // This case turns that improvement into a red test instead of leaving two
      // erasure paths racing over the same rows.
      const definition = (schema as unknown as NodeSlideSchemaLike).tables[table];
      expect(definition, `${table} is not in convex/schema.ts`).toBeDefined();
      const deckIdField = definition?.validator.fields?.['deckId'];
      const isRequiredDeckId = deckIdField?.kind === 'string' && !deckIdField.isOptional;
      expect(isRequiredDeckId, `${table} now has a required deckId`).toBe(false);
    },
  );

  it('states a reason for every derived exclusion, and never claims the rows are content-free', () => {
    for (const exclusion of derivedExclusions) {
      expect(exclusion.detail.length, `${exclusion.table} has no stated reason`).toBeGreaterThan(
        80,
      );
      // The one argument that must never appear here: these tables DO hold user
      // data. An exclusion whose justification is "no user data" would be the
      // lie that turns a retention bug into a compliance one.
      expect(exclusion.detail.toLowerCase()).not.toContain('holds no');
    }
  });

  it('discloses the derived tables in the export bundle rather than omitting them silently', () => {
    // A data-export bundle that just does not contain these rows, with no note,
    // is a bundle that quietly under-reports what the product stored.
    const exportSource = readFileSync(
      path.join(convexDirectory, 'lib', 'nodeslideDataExport.ts'),
      'utf8',
    );
    expect(exportSource).toContain('NODESLIDE_ERASURE_EXCLUSIONS');
  });

  it('reads the budget child tables against the envelope, not the incremental sweep cap', () => {
    // `DERIVED_SWEEP_LIMIT` is sound for the job-anchored tables: a job that
    // does not fit one transaction survives it, and the next call re-derives
    // everything hanging off that surviving row. The budget tables have no
    // anchor that survives — their id comes from `job.budgetId` and the job is
    // deleted in the same pass — so a capped read strands rows behind an id
    // nothing can produce again. `meter.nextLimit()` returns one past the
    // remaining budget, so an over-large ledger refuses the whole erasure
    // instead. The behavioural half of this lives in `nodeslideRetention.test.ts`.
    //
    // The envelope is now reached through `NodeSlideErasureMeter`, which measures
    // the deck against its own ceiling and the batch's shared plan budget at
    // once. `nextLimit()` is the tighter of the two, so this read is bounded by
    // the batch as well as by the deck — a strictly stronger version of what this
    // case has always asserted.
    const budgetLoop = retentionSource.slice(retentionSource.indexOf('for (const budgetId of'));
    const body = budgetLoop.slice(0, budgetLoop.indexOf('return { groups'));
    expect(body, 'a budget child read still uses the incremental sweep cap').not.toContain(
      'sweepLimit()',
    );
    expect(body).toContain('meter.nextLimit()');
  });

  it('never leaves a storage pointer behind in the budget tables it sweeps', () => {
    // The field list for blob deletion is derived from the schema, never hand
    // written, because a hand list goes stale the moment somebody adds a
    // column. This case states the current fact the derivation reports: no
    // table in the budget cluster holds a `v.id('_storage')`, so the sweep has
    // no blobs to delete ahead of its rows. If that ever changes, the schema
    // grows a pointer and this expectation fails, which is the intended alarm.
    const schemaSource = readFileSync(path.join(convexDirectory, 'schema.ts'), 'utf8');
    for (const table of ['nodeslide_run_budgets', 'nodeslide_billable_calls'] as const) {
      const start = schemaSource.indexOf(`${table}: defineTable({`);
      expect(start, `${table} is not declared in schema.ts`).toBeGreaterThan(-1);
      const body = schemaSource.slice(start, schemaSource.indexOf('defineTable({', start + 40));
      expect(body, `${table} gained a storage pointer with no blob-first deletion`).not.toContain(
        "v.id('_storage')",
      );
    }
  });
});
