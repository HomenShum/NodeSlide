import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

/**
 * What this gate is for
 * ---------------------
 * Before anything leaves the browser, a first-time arrival must be told which
 * route their work will take and be offered a no-egress alternative; the
 * external route must be one visible choice rather than a default nobody was
 * shown; and on a phone the storyboard must still expose per-slide actions
 * and add-slide.
 *
 * The gate used to establish the first two facts through `first-run-dialog`
 * and the copy "Deterministic by default · OpenRouter opt-in", then through
 * an `ai-provider-consent` checkbox that was disabled until an
 * `ai-provider-openrouter` radio was selected. All four anchors were removed
 * by product changes, not by a regression:
 *   - the modal interstitial was replaced by the landing surface
 *     (`nodeslide-landing`), which carries the egress cue inline; and
 *   - the radio-plus-checkbox consent was replaced by an always-visible model
 *     pill, where naming an external model and sending IS the consent
 *     (AiInspector.tsx, "Zero-friction consent").
 *
 * Two honest consequences are asserted rather than papered over. The default
 * route on arrival is now a named external model, not deterministic, so this
 * gate asserts what is true and load-bearing — the exact route is named
 * before any send, and a private no-egress option is offered — instead of the
 * old "deterministic by default" claim. And the composer now needs no
 * disclosure at all to show its route, which is a stronger form of the "one
 * disclosure" property the old assertion was protecting.
 */

const url = process.env.NODESLIDE_QA_URL ?? 'https://nodeslide.vercel.app/';
const outDir = process.env.NODESLIDE_QA_OUT;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openSample(page) {
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  const landing = page.getByTestId('nodeslide-landing');
  await landing.waitFor({ state: 'visible', timeout: 30_000 });
  assert(await landing.isVisible(), 'Fresh sessions must expose the landing surface.');

  // The egress cue is on the arrival surface, not behind a click.
  const privacyCue = page.getByTestId('landing-privacy-cue');
  assert(await privacyCue.isVisible(), 'The arrival surface must carry a visible egress cue.');
  const cueText = (await privacyCue.innerText()).trim();
  assert(cueText.length > 0, 'The egress cue must not be empty.');

  // Whatever the default is, the cue must agree with the model actually
  // selected: a private route says so, an external route names its provider.
  const selectedModel = await page.getByTestId('landing-model-select').inputValue();
  if (selectedModel === 'deterministic') {
    assert(
      /no external model|private/i.test(cueText),
      `A private default must be described as private. Cue: ${cueText}`,
    );
  } else {
    assert(
      /via\s+\S+/i.test(cueText),
      `An external default must name the provider it routes to. Cue: ${cueText}`,
    );
  }

  // The no-egress alternative must be offered before the first send.
  const modelOptions = await page
    .locator('[data-testid="landing-model-select"] option')
    .allInnerTexts();
  assert(
    modelOptions.some((option) => /no external model/i.test(option)),
    `The arrival surface must offer a no-egress option. Options: ${modelOptions.join(' | ')}`,
  );

  await page.getByTestId('landing-explore-sample').click();
  await page.getByTestId('nodeslide-studio').waitFor({ state: 'visible' });
}

const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1512, height: 812 } });
  await openSample(desktop);
  await desktop.getByTestId('inspector-tab-ai').click();
  await desktop.getByTestId('ai-composer').waitFor({ state: 'visible', timeout: 20_000 });

  // Route status with zero disclosures: the model pill sits in the composer
  // footer and names the route without opening anything.
  const modelSelect = desktop.getByTestId('ai-model-select');
  assert(
    await modelSelect.isVisible(),
    'The composer must name its route without a disclosure step.',
  );
  const initialRoute = (await modelSelect.innerText()).trim();
  assert(initialRoute.length > 0, 'The composer route pill must not be empty.');

  // The egress choice is live and reversible before any send: switching to the
  // private fallback must visibly change the named route.
  await modelSelect.click();
  await desktop.getByRole('option', { name: /Deterministic/i }).click();
  await modelSelect.getByText('Private', { exact: false }).waitFor({ timeout: 10_000 });
  await modelSelect.click();
  await desktop.getByRole('option', { name: /GLM 5\.2/ }).click();
  const externalRoute = (await modelSelect.innerText()).trim();
  assert(
    /GLM 5\.2/.test(externalRoute),
    `Choosing an external model must be visible in the composer. Route: ${externalRoute}`,
  );

  // The advanced controls remain a real second surface, not the only one.
  await desktop.getByTestId('ai-provider-summary').click();
  const routeStatus = desktop.getByTestId('ai-provider-route-status');
  await routeStatus.waitFor({ state: 'visible', timeout: 10_000 });
  const routeStatusText = await routeStatus.innerText();
  assert(
    /external model: on/i.test(routeStatusText),
    `Advanced controls must state the external-model posture. Status: ${routeStatusText}`,
  );
  // The popover is left open on purpose: the desktop screenshot this gate
  // captures is the provider-controls evidence shot.
  //
  // Note for whoever reads this next: on a 1512x812 desktop the popover renders
  // beneath the toolbar, so `ai-advanced-close` is present and enabled but not
  // clickable — the command-palette button intercepts the pointer, and Escape
  // pressed inside the popover does not dismiss it either. That is a live UI
  // defect on the shipped build, reported separately. This gate does not assert
  // on dismissal, so it neither hides the defect nor fails on it.

  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await openSample(phone);
  const phoneSlideActions = phone.getByRole('button', { name: 'Slide 1 actions' });
  await phoneSlideActions.waitFor({ state: 'attached', timeout: 30_000 });
  assert(
    await phoneSlideActions.isVisible(),
    'Phone storyboard must retain a visible slide-actions path.',
  );
  assert(
    await phone.getByRole('button', { name: 'Add slide' }).isVisible(),
    'Phone storyboard must retain a visible add-slide path.',
  );

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await desktop.screenshot({ path: `${outDir}/b8-desktop-provider-controls.png` });
    await phone.screenshot({ path: `${outDir}/b8-phone-slide-actions.png` });
  }
  console.log(`PASS NodeSlide agent operability · ${url}`);
  console.log('PASS the arrival surface names its route and offers a no-egress option');
  console.log('PASS the composer route is visible with zero disclosures and is reversible');
  console.log('PASS phone slide actions and add-slide remain visible');
} finally {
  await browser.close();
}
