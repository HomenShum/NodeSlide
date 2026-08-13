# Integrations — everything that talks to something outside this repo

For each: what it is for, where it is configured, what breaks without it, and
whether you need it to work on the codebase. **Nothing in this file contains a
secret. Nothing in this repository should.**

## Convex — the backend and database (required)

- **Where:** `convex/`, registered components in `convex/convex.config.ts`.
- **Set up:** `npx convex dev` provisions an anonymous local deployment, needs
  no account, and writes `VITE_CONVEX_URL` into `.env.local`.
- **Without it:** `src/main.tsx` catches the connection failure and renders the
  panel marked `data-testid="deployment-configuration-error"`.
- **Needed to develop?** Yes. Almost everything is a Convex function.

Two Convex components are registered and both have live consumers — read the
comment in `convex/convex.config.ts` before removing either:
`@convex-dev/workflow` (durable jobs) and `@convex-dev/persistent-text-streaming`
(the stream body every job row points at; `startCreateDeck` fails before writing
a row if it is missing).

## Model providers — OpenRouter and Nebius (optional)

- **Where:** `convex/lib/nodeslideProvider.ts`. OpenRouter at
  `https://openrouter.ai/api/v1`, Nebius Token Factory at
  `https://api.tokenfactory.nebius.com/v1`, both through
  `@earendil-works/pi-ai`.
- **Configured by:** `OPENROUTER_API_KEY` / `NEBIUS_API_KEY` in the **Convex**
  environment (`npx convex env set`), never in the browser bundle.
- **Consent is explicit.** A create or edit that uses a live provider must carry
  a consent string (`NODESLIDE_OPENROUTER_BRIEF_CONSENT` and friends). A request
  without it is refused by `validateNodeSlideBriefProviderChoice`, so a deck
  cannot be sent to a third party by accident.
- **Without a key:** choose `deterministic` in the model dropdown.
  `deterministicBriefSpec` produces the same shape offline and the whole path in
  `docs/START_HERE.md` still executes.
- **Needed to develop?** No.

## Admission gating (blocking on a fresh clone — see CONCERNS.md)

Three environment variables in the Convex deployment decide whether a stranger
may create a deck at all: `NODESLIDE_PUBLIC_CREATION`,
`NODESLIDE_PREVIEW_ACCESS_CODE`, `NODESLIDE_PREVIEW_ADMISSION_SUBJECT`
(`convex/lib/nodeslideValidators.ts:255`). `npx convex dev` sets none of them,
and there is no `.env.example`. This is defect **D1** in
`promotion/PROMOTION_LOG.md`.

For a local deployment, one command clears it:

```bash
npx convex env set NODESLIDE_PUBLIC_CREATION true
```

Verified end to end — see `docs/codebase/CONCERNS.md` §1 for the before/after
receipt. Note these live in the **Convex** environment, not in `.env.local`;
`.env.local` only carries `VITE_CONVEX_URL` for the browser.

## Google Slides (optional)

- **Where:** `src/domains/nodeslide/integrations/googleSlides/` (adapter,
  normalisation, three-way sync planning) and
  `convex/nodeslideGoogleSlidesRuntime.ts`.
- **Talks to:** `https://slides.googleapis.com`, `https://www.googleapis.com`,
  `https://oauth2.googleapis.com`.
- **Configured by:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `NODESLIDE_GOOGLE_REDIRECT_URI`, and `NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY` —
  tokens are stored encrypted in `nodeslide_oauth_credentials`.
- **Note:** the sync is a *three-way* plan (local, remote, common ancestor), not
  a push. `planGoogleSlidesThreeWaySync` decides; it does not overwrite.
- **Needed to develop?** No. The transport is faked in
  `googleSlidesTransport.scenario.test.ts`.

## Openverse — licensed images (optional)

- **Where:** `convex/lib/nodeslideImageSearch.ts` (URL construction and licence filter), called from `convex/nodeslideImages.ts`. Host: `https://api.openverse.org`.
- **Why it exists:** a slide may only carry an image whose licence and credit
  are recorded. Un-credited images are refused rather than rendered as evidence.
- **Needed to develop?** No.

## MCP — NodeSlide for coding agents (optional)

- **Where:** `mcp/`, tools registered in `mcp/src/lib/nodeslideTools.ts:414`.
- **How it connects:** stdio MCP server that calls the same Convex functions the
  browser calls. Provider keys stay in the MCP process — `nodeslide.byok_status`
  reports presence and never returns a value.
- **Needed to develop?** No, unless you are changing the tool surface.

## Vercel — hosting (optional)

- **Where:** `vercel.json`, build command `npm run vercel-build`, one serverless
  function `api/share.ts` behind the `/s/:shareSlug` rewrite.
- **Worth knowing:** the Content-Security-Policy header is strict and explicit.
  `connect-src` lists exactly `api.openai.com`, `api.openverse.org` and the
  Convex hosts. Adding an outbound host in code without adding it here produces
  a browser-only failure that no test will catch.
- **Deployment is not automatic** (`git.deploymentEnabled: false`).

## Observability (optional)

`OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`, read in
`convex/`. Unset means no export; nothing else changes.

## The minimum to run everything you can run locally

```
npx convex dev        # provisions the backend, writes VITE_CONVEX_URL
npm run dev:web       # http://localhost:5180 — use localhost, not 127.0.0.1
```

Then pick `deterministic` in the model dropdown. No key, no account, no
third-party call.
