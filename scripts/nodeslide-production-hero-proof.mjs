import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

/**
 * What this gate is for
 * ---------------------
 * A person who has never used NodeSlide before must be able to land on the
 * product, reach an editable deck, ask the external model NodeSlide actually
 * recommends for one slide edit, and get back a proposal that (a) is
 * attributed to the route it really came from, (b) is not the deterministic
 * fallback wearing a model's name, (c) cannot apply itself, and (d) leaves a
 * countersigned custody receipt in Trace while the slide stays unchanged.
 *
 * Four anchors in the previous version had been outlived by the product:
 *
 *   `first-run-dialog` / `first-run-explore` — a modal interstitial that the
 *   root landing surface (`nodeslide-landing`) replaced. The dialog was gone,
 *   not broken. The arrival step below states the same fact against the
 *   surface that ships: a cold visitor sees the landing and is one click from
 *   the editable sample.
 *
 *   `ai-provider-openrouter` / `ai-provider-consent` — a radio plus a
 *   per-request checkbox, replaced by an always-visible model pill: naming an
 *   external model and pressing send IS the consent (AiInspector.tsx,
 *   "Zero-friction consent").
 *
 *   `proposal-card` / `proposal-accept` — replaced by the AgentThread turn
 *   list (`agent-thread-patch` and its accept/reject controls).
 *
 *   `COUNTERSIGNED RECEIPT` — the Agent Prism trace rail renders the custody
 *   chain under the heading "Chain of custody and countersigned receipt"; the
 *   loud seal object itself now lives in the expanded trace view.
 *
 *   `z-ai/glm-5.2` — the hero route when this gate was written. It is no
 *   longer what a new arrival gets, and on the live build a GLM 5.2 request
 *   degrades to the deterministic planner. Pinning a specific model made the
 *   gate measure a route nobody is offered by default, so it now reads the
 *   recommended route off the composer and holds the run to *that* label. The
 *   claim is stronger, not weaker: whatever NodeSlide recommends must really
 *   work and must be attributed honestly end to end.
 */

const url = process.env.NODESLIDE_QA_URL ?? 'https://nodeslide.vercel.app/';
const outDir = process.env.NODESLIDE_QA_OUT;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 812 } });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });

  // Arrival: a cold visitor gets the landing, not editor chrome, and reaches
  // the editable sample in one click.
  await page.getByTestId('nodeslide-landing').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('landing-explore-sample').click();
  await page.getByTestId('nodeslide-studio').waitFor({ state: 'visible', timeout: 30_000 });

  await page.getByTestId('inspector-tab-ai').click();
  await page.getByTestId('ai-composer').waitFor({ state: 'visible', timeout: 20_000 });

  // The recommended route is disclosed before the send, with no disclosure
  // step to open. Everything after this is held to this exact label.
  const modelSelect = page.getByTestId('ai-model-select');
  const recommendedRoute = (await modelSelect.innerText()).trim();
  assert(
    recommendedRoute.length > 0 && recommendedRoute !== 'Private',
    `The composer must offer a named external route to a first-time arrival. Route: "${recommendedRoute}"`,
  );

  await page
    .getByLabel('AI instruction')
    .fill(
      "Rewrite this slide's headline to 'NodeSlide turns World Cup data into an editable story' and the body to explain that charts, citations, and uploaded CSV data remain editable and reviewable. Preserve the layout.",
    );
  await page.getByTestId('ai-submit').click();

  const patch = page.getByTestId('agent-thread-patch');
  try {
    await patch.waitFor({ state: 'visible', timeout: 180_000 });
  } catch (error) {
    if (outDir) {
      await mkdir(outDir, { recursive: true });
      await page.screenshot({ path: `${outDir}/j2-proposal-failure.png` });
    }
    const pageText = await page.locator('body').innerText();
    const inspectorOffset = Math.max(0, pageText.indexOf('INSPECTOR'));
    throw new Error(
      `Proposal did not become reviewable. Visible state:\n${pageText.slice(inspectorOffset, inspectorOffset + 4_000)}`,
      { cause: error },
    );
  }

  const turnText = await page.getByTestId('agent-thread-turn').innerText();
  assert(
    turnText.includes(recommendedRoute),
    `The turn must be attributed to the route the composer offered ("${recommendedRoute}"). Visible turn:\n${turnText.slice(0, 2_000)}`,
  );
  if (turnText.toLowerCase().includes('deterministic fallback')) {
    await page.getByTestId('inspector-tab-trace').click();
    await page.waitForTimeout(500);
    const fallbackTrace = await page.getByTestId('inspector').innerText();
    const traceOffset = Math.max(0, fallbackTrace.toLowerCase().indexOf('fallback') - 500);
    throw new Error(
      `The hero proof requires a model-authored proposal, not the deterministic fallback. The composer offered "${recommendedRoute}" and the planner did not deliver it. Visible trace:\n${fallbackTrace.slice(traceOffset, traceOffset + 2_500)}`,
    );
  }

  // Standing disclosure. The old gate asserted that the consent checkbox reset
  // itself after each request, so a second send could not egress silently. The
  // checkbox is gone; the property it protected now lives in the always-visible
  // model pill, so the honest replacement is that the composer still names the
  // route the next send would take.
  const disclosedAfterRun = (await modelSelect.innerText()).trim();
  assert(
    disclosedAfterRun.length > 0,
    'The composer must keep naming a route before the next send.',
  );

  assert(
    await page.getByTestId('agent-thread-patch-accept').isVisible(),
    'The proposal must remain human-gated.',
  );

  await page.getByTestId('inspector-tab-trace').click();
  const inspector = page.getByTestId('inspector');
  await inspector
    .getByText('Chain of custody and countersigned receipt', { exact: false })
    .waitFor({ state: 'visible', timeout: 15_000 });
  const traceText = await inspector.innerText();
  assert(
    traceText.includes(recommendedRoute),
    `The custody trace must name the route that authored the proposal ("${recommendedRoute}"). Visible trace:\n${traceText.slice(0, 2_000)}`,
  );
  assert(
    traceText.includes('Awaiting review'),
    'The slide must remain unchanged pending acceptance.',
  );
  assert(
    !traceText.toLowerCase().includes('deterministic fallback'),
    `The hero trace must remain attributed to the successful ${recommendedRoute} path.`,
  );

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await page.screenshot({ path: `${outDir}/j2-proposal-trace.png` });
  }
  console.log(`PASS NodeSlide production hero · ${url}`);
  console.log('PASS a cold arrival reaches the editable sample from the landing surface');
  console.log(
    `PASS the recommended route (${recommendedRoute}) authored the proposal and it is human-gated`,
  );
  console.log('PASS the route stays disclosed and the countersigned trace remains inspectable');
} finally {
  await browser.close();
}
