import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'playwright/test';

// @ts-expect-error -- the probe is a plain .mjs gate script, like every other file in scripts/.
import { runTrustSurfaceProbe } from '../../scripts/nodeslide-trust-surface-runtime-probe.mjs';

/**
 * The runner the census names.
 *
 * `nodeslide-trust-surface-census.mjs` reports two clauses as NOT-RUN and probes the
 * filesystem for THIS EXACT PATH to decide what to print next to them:
 *
 *     const command = specExists
 *       ? `npx playwright test ${BROWSER_SPEC}`
 *       : `NO RUNNER YET — ${BROWSER_SPEC} does not exist; writing it is what would make
 *          this clause runnable`;
 *
 * with the comment "the message changes by itself the day someone writes the file". This is
 * that file. It exists so the census stops advertising a runner that does not exist — a
 * not-run citing a command nobody can run is its own quiet lie, the same species as a success
 * colour on a pending state.
 *
 * It is deliberately thin. All four clauses live in the probe module, which is also driven by
 * `npm run probe:trust-surfaces` and unit-tested in `scripts/tests/`. Two entry points, one
 * implementation — the same discipline that keeps the census and the agent-UI linter from
 * becoming two gates with two verdicts.
 *
 * NOT wired into required CI. It needs a deployed URL and it grades a live product, so as a
 * required gate it would be flaky in a way that teaches people to ignore red. See the PR
 * body for the recommended wiring (nightly, against production).
 */
const TARGET =
  process.env['NODESLIDE_PROBE_BASE_URL'] ??
  process.env['PLAYWRIGHT_BASE_URL'] ??
  'https://nodeslide.vercel.app';

test('trust surfaces: clause 3 cascade + clause 4 declared-vs-rendered, on a rendered page', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const report = await runTrustSurfaceProbe({ browser, baseUrl: TARGET });

  const receipt = path.resolve('artifacts/trust-surfaces/runtime-probe.json');
  await mkdir(path.dirname(receipt), { recursive: true });
  await writeFile(receipt, `${JSON.stringify(report, null, 2)}\n`);
  await test.info().attach('trust-surface-runtime-probe.json', {
    path: receipt,
    contentType: 'application/json',
  });

  // Reported before the assertion so a failure run still publishes the full picture —
  // including which surfaces were never reached and why, which is the half of the result
  // that a bare pass/fail throws away.
  const reached = report.surfaces.filter((s: { reached: boolean }) => s.reached);
  console.log(
    `probed ${TARGET} @ ${report.buildSha}: ${reached.length}/${report.surfaces.length} surfaces reached, ` +
      `verdicts ${JSON.stringify(report.summary.tally)}`,
  );
  for (const surface of report.surfaces) {
    if (!surface.reached)
      console.log(`  not-run ${surface.selector ?? surface.key}: ${surface.requires}`);
  }

  // Arm the sensor before trusting the green: if NOTHING was reachable, an empty failure list
  // means the probe never looked at anything, not that the product is clean.
  expect(
    reached.length,
    'no trust surface was reachable — this run proves nothing',
  ).toBeGreaterThan(0);
  expect(report.summary.failures).toEqual([]);
});
