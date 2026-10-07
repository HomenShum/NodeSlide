# Stack

What is installed, why it is here, and what you would have to replace it with
if you took it out. Versions are from the root `package.json` at the Wave 3
commit; run `npm ls --depth 0` for today's.

## The four things that matter

| Layer | Choice | Why it, specifically |
|---|---|---|
| Backend + database | **Convex** `^1.42.1` | It is one product, not three. Queries are live subscriptions, so the editor needs no polling and no websocket code (`useQuery` in `NodeSlideStudio.tsx`). Mutations are serialisable transactions, which is what makes the version check in `convex/lib/nodeslidePatches.ts` safe. Actions can call an external model with a timeout. Replacing it means writing a database layer, a subscription layer and a job runner. |
| UI | **React 19.2.8** + **Vite 6** | Nothing exotic. No Next.js, no router: `src/App.tsx` renders one component for every URL. |
| Types at the boundary | **Zod 4** (MCP tools, scripts) and **Convex validators** (`v.*`, backend) | Two validators, two boundaries. Convex's own validators run *before* a handler body and reject undeclared fields; Zod guards the MCP process, which Convex never sees. |
| Styling | **Tailwind 4** via `@tailwindcss/vite`, plus hand-written CSS | The deck surfaces (`nodeslideV3.css`, 7,531 lines) are hand-written because slide geometry is not utility-class shaped. Application chrome is Tailwind. |

## Everything else, grouped by what it does

**Producing a deck**
- `@earendil-works/pi-ai` `0.80.6` — the model client. Providers are configured in `convex/lib/nodeslideProvider.ts`: OpenRouter (`https://openrouter.ai/api/v1`) and Nebius Token Factory.
- `ai` `^7` — Vercel AI SDK types used by the composer surface.
- `zod` `^4.3.6` — response schemas.

**Rendering and exporting a deck**
- `pptxgenjs` `^4` — editable PowerPoint export (`src/domains/nodeslide/slidelang/pptx.ts`, dynamically imported so it is not in the entry chunk).
- `katex` `^0.18` — formula rendering. Ships its own types; do not add `@types/katex`.
- `pdfjs-dist` `^6`, `jszip` `^3` — reading uploaded PDFs, and unpacking `.pptx` on import.

**Interface pieces**
- `radix-ui` `^1.6.2` — the accessible primitives under `src/components/ui/` (select, tooltip, dropdown-menu, collapsible).
- `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge` — icons and class composition.
- `@fontsource-variable/*` — self-hosted fonts. The CSP in `vercel.json` allows `font-src 'self' data:` only, so a CDN font would be blocked.

**Convex components** (registered in `convex/convex.config.ts` — read the comment there before removing either)
- `@convex-dev/workflow` — durable multi-step jobs.
- `@convex-dev/persistent-text-streaming` — the stream body each job row points at.

**Vendored, not from the registry**
- `@nodebook/{contracts,core,model,react}` — installed from `vendor/nodebook/*.tgz`. `@nodebook/core` is declared at the root even though no source file imports it, because `@nodebook/react` depends on it and the `file:` path is the only way it resolves. Knip flags it; ignore that.
- `@homenshum/nodekit` — a git dependency pinned to a commit SHA.

**Tooling**
- `vitest` `^4` — one runner for the app, convex, packages and scripts.
- `biome` `^1.9` — formatter and linter in one (`npm run lint`). 100-column, single quotes, semicolons, trailing commas.
- `tsup` `^8` — builds every workspace in `packages/*`. See CONCERNS.md before nesting an `npm run` inside a workspace build.
- `playwright` `^1.61` — end-to-end specs in `tests/e2e/`, which target a deployed URL rather than a local server.
- `convex-test` `0.0.54` — runs Convex functions in-process, which is why most backend tests need no server.

## Not here on purpose

No Redux/Zustand/Jotai — server state is Convex, local state is `useState`.
No React Router — one component, one query parameter.
No Storybook or docs site — this folder plus `.tours/` is the documentation.
No ORM — Convex is the schema (`convex/schema.ts`, 57 tables).
