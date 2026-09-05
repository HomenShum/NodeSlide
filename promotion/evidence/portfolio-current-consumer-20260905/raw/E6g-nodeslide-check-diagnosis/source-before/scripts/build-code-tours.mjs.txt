/**
 * The three CodeTours in `.tours/` are stored with line numbers, and a line
 * number silently rots: someone adds an import at the top of a file and every
 * step below it now points one line high. Nothing fails, and the tour quietly
 * starts lying to the next reader.
 *
 * So the tours are generated, not hand-written. The `step(file, needle, …)`
 * calls below hold the distinctive string each step actually points at; this
 * script finds its current line and writes the JSON.
 *
 *   node scripts/build-code-tours.mjs           regenerate after moving code
 *   node scripts/build-code-tours.mjs --check   fail if the committed tours drifted
 *
 * `--check` runs in the test suite (`scripts/tests/code-tours.test.mjs`), so a
 * refactor that moves a step's code becomes a failing test rather than a wrong
 * walkthrough. A deleted anchor throws by name, which tells you which step to
 * re-aim.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const anchor = (file, needle, occurrence = 1) => {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      seen += 1;
      if (seen === occurrence) return i + 1;
    }
  }
  throw new Error(`anchor not found: ${needle} in ${file}`);
};

const step = (file, needle, description, occurrence = 1) => ({
  file,
  line: anchor(file, needle, occurrence),
  description,
});

const tours = [
  {
    path: '.tours/01-primary-user-flow.tour',
    title: '1 · Brief in, deck out',
    description:
      'Follow one person typing a description of a presentation and pressing Create, from the browser tab to the database row. Companion to docs/START_HERE.md.',
    steps: [
      step(
        'src/main.tsx',
        'new ConvexReactClient(convexWsUrl())',
        '**Where the app starts.**\n\nNodeSlide keeps no application state in the browser bundle. Decks, versions, proposals and receipts all live in Convex, which pushes changes to every open tab. So the first thing that must succeed is this connection.\n\nIf it throws, the `catch` below renders a plain explanation panel instead of a blank screen — a blank page is the failure mode nobody can debug.',
      ),
      step(
        'src/App.tsx',
        'export default function App()',
        "**There is no router.**\n\nEvery URL renders `NodeSlideStudio`. The single exception is `?domain=atlas`, a read-only gallery that shares no state with the editor and is therefore lazy-loaded.\n\nIf you are looking for 'the page for X', there isn't one. The studio owns the whole surface, including its own empty state.",
      ),
      step(
        'src/domains/nodeslide/components/NodeSlideLanding.tsx',
        'const start = () => {',
        "**The primary user action.**\n\nThis is where a free-form paragraph becomes a structured request. The person typed one sentence; the generator needs an audience, a purpose and success criteria, so `start` supplies sensible defaults rather than interrogating the user with a form.\n\nEverything downstream can therefore assume a complete request shape. Note `route: 'free'` — it is the only route this release accepts, and the server rejects the others.",
      ),
      step(
        'src/domains/nodeslide/NodeSlideStudio.tsx',
        'const createDeck = async (request: CreateDeckAdmissionRequest)',
        '**One click, one budgeted run.**\n\n`creationAttemptId` is minted here, on the click. Convex may retry the action with the same arguments — that must reuse the same id and not charge twice. A *later* click mints a new id even if the brief is byte-for-byte identical, because that is a second deliberate request.\n\nThe `requestGate` guards against a slow first request landing after a faster second one and overwriting it.',
      ),
      step(
        'convex/nodeslideAgent.ts',
        'export const createDeckFromBrief = action({',
        '**The trust boundary.**\n\nAbove this line, values came from a browser and are suspect. Below it, everything is typed and checked.\n\nConvex validates every argument against this `args` object *before* the handler body runs, and rejects any undeclared field. Read the comment on `durableJob` below — declaring that one field was the difference between working durable jobs and every job dying at 35% progress.',
      ),
      step(
        'convex/nodeslideAgent.ts',
        'THE OUTPUT-IDENTITY BINDING',
        '**Why the cheap checks run first.**\n\nBoth checks below are pure string comparisons over arguments already in hand: no database read, no quota, no provider call. A caller that cannot name the job whose deck it claims to produce is refused *for free*.\n\nMoving either check later would turn a free refusal into one that arrives after a paid completion. This ordering is the rule the whole file obeys.',
      ),
      step(
        'convex/lib/nodeslideValidators.ts',
        'export async function validateNodeSlidePreviewAdmission',
        "**Who is allowed to create a deck.**\n\nThree ways in: the public-creation flag, an existing durable job row, or a preview access code paired with an admission subject.\n\nOn a fresh clone `npx convex dev` sets none of them, so this is where a stranger's first Create fails. That is defect D1 in `promotion/PROMOTION_LOG.md` and concern 1 in `docs/codebase/CONCERNS.md`.",
      ),
      step(
        'convex/nodeslideAgent.ts',
        'const briefJsonSchema = {',
        '**The model is asked for intent, not geometry.**\n\nSlide count, allowed element kinds, and required provenance fields are enforced by this JSON schema — not hoped for in prose. `minItems`/`maxItems` come from the count the user actually asked for.\n\nA model that returns coordinates cannot be checked. A model that returns a typed plan can, and deterministic code turns the plan into positioned elements.',
      ),
      step(
        'convex/nodeslideAgent.ts',
        'const briefDispatch = createNodeSlideBudgetedCreateDispatch({',
        '**A ceiling enforced by code, not by prompt.**\n\nThe dispatch reserves budget against a ledger row keyed by the run id, calls the provider with a hard timeout, and reconciles the spend afterwards.\n\nNote the comment on `timeoutMs`: the create path carries its own wire ceiling because full-deck generation legitimately takes minutes, and the 30-second edit-path default would guarantee a timeout and a silently degraded deck.',
      ),
      step(
        'convex/nodeslideAgent.ts',
        'if (nodeSlideCreateSpendUnreconciled(provider)) {',
        '**Fail closed on an ambiguous charge.**\n\nIf the paid call ended without a reconcilable billing receipt, creation stops here. No fallback deck is produced under an unresolved charge.\n\nA provider *failure* is different and does fall back to the deterministic generator. Failure and ambiguity are not the same thing, and this repository refuses to treat them alike.',
      ),
      step(
        'convex/nodeslideAgent.ts',
        'return await ctx.runMutation(nodeslideInternal.createFromBriefInternal',
        '**The only write.**\n\nEverything above was computation. This one mutation persists the deck, its slides, its elements and their version clocks in a single transaction.\n\nFrom here on, every change to this deck goes through the version check in tour 2.',
      ),
      step(
        'src/domains/nodeslide/NodeSlideStudio.tsx',
        'const queriedWorkspace = useQuery(',
        '**How the result reaches the screen.**\n\nNo polling, no hand-written socket. `useQuery` subscribes; when a mutation changes a row this query read, Convex pushes the new result and React re-renders.\n\nIf you find yourself adding an interval timer, the state you want is probably not in the database yet. Put it there instead.',
      ),
      step(
        'src/domains/nodeslide/components/SlideRenderer.tsx',
        'export function SlideRenderer(',
        '**Slides are drawn from the canonical record.**\n\nCharts, formulas and diagrams become real DOM and SVG elements. That is what makes them clickable and editable rather than a picture of a chart — and it is why the same record can also compile to editable PowerPoint.',
      ),
    ],
  },
  {
    path: '.tours/02-agent-execution.tour',
    title: '2 · An AI edit, reviewed',
    description:
      'The product thesis, in code: an agent proposes a change, the server checks it against the version of the deck it was written for, and only then does anything move. Includes how a coding agent reaches the same path.',
    steps: [
      step(
        'convex/nodeslideAgent.ts',
        'export const proposeEdit = action({',
        '**The second, and last, place a model is called.**\n\nNote what the caller must supply: `baseDeckVersion`, `baseSlideVersions`, `baseElementVersions` and a `scope`. The client is stating exactly which version of the deck it is proposing against, and how much of it it is allowed to touch.\n\nThat is what makes the check three steps down possible.',
      ),
      step(
        'convex/nodeslideAgent.ts',
        "if (!instruction) throw new Error('NodeSlide edit instruction is required.')",
        '**Cheapest refusals first, again.**\n\nEmpty instruction, over-long instruction, wrong command id, missing provider consent — all rejected before any model call. Same rule as the create path.',
      ),
      step(
        'mcp/src/lib/nodeslideTools.ts',
        'export function registerNodeSlideTools(',
        '**A coding agent is a first-class user.**\n\nThis is not a second backend. Each MCP tool validates its arguments with Zod and then calls the *same* Convex function the browser calls.\n\nOne write path means an agent cannot bypass the version check — which is the entire safety argument for letting an agent edit a deck at all.',
      ),
      step(
        'mcp/src/lib/nodeslideTools.ts',
        "'nodeslide.get_deck'",
        "**Read tools declare themselves read-only.**\n\n`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` — these annotations are how the calling agent's host decides whether to ask a human first.\n\nThe description also states what the tool will *not* do: it never returns the owner key.",
      ),
      step(
        'mcp/src/lib/nodeslideTools.ts',
        "'nodeslide.propose_edit'",
        "**The write tool proposes; it does not commit.**\n\nIt returns an `unappliedProposalReceipt`. Committing is a *separate* tool — `nodeslide.accept_proposal`, a few lines below — which is described as an 'Explicit review action'.\n\nAn agent can produce a proposal; accepting it is its own deliberate call. That asymmetry is the product, not a limitation of the integration.",
      ),
      step(
        'convex/nodeslide.ts',
        'export const proposePatch = mutation({',
        '**Where every change enters, whoever made it.**\n\n`applyPatch` (direct), `proposePatch` (review first) and `proposePropagation` (apply an accepted change to matching slides) all normalise into the same shape and all end up at the same check.',
      ),
      step(
        'convex/lib/nodeslidePatches.ts',
        'export function evaluateNodeSlideCas(',
        '**The heart of the system.**\n\nCompare-and-set. The patch recorded the version of everything it touched; this compares those numbers to the database *right now*, inside the same transaction.\n\nEqual → commit and bump. Different → the patch is stored with status `stale` and a human-readable list of exactly what moved.\n\nThis is why two people, or a person and an agent, cannot silently overwrite each other.',
      ),
      step(
        'convex/lib/nodeslidePatches.ts',
        'export function touchedNodeSlideIds(',
        '**The function to be most careful with.**\n\nThe check above only protects ids that this function reports. Add a new patch operation without teaching this function which ids it touches, and the operation will pass the version check *without being checked*.\n\nIf you add an operation type, this is the second file you edit, and there is no compiler error to remind you.',
      ),
      step(
        'convex/nodeslide.ts',
        'export const acceptPatch = mutation({',
        '**Acceptance is one transaction.**\n\nThe commit, the version bump and the decision record either all land or all roll back. There is no window in which a deck has advanced but its receipt has not.',
      ),
      step(
        'shared/nodeslidePatch.test.ts',
        'rejects stale patches before mutation',
        '**The test that proves it.**\n\nIf you change anything in `evaluateNodeSlideCas`, this is the test that tells you whether you broke the guarantee. Its siblings above and below cover scope violations, geometry clamping and forged artifact bindings.',
      ),
    ],
  },
  {
    path: '.tours/03-debug-and-recovery.tour',
    title: '3 · When it goes wrong',
    description:
      'Three things fail differently — the request is refused, the worker dies, the build breaks — and each has its own recovery. Read this before debugging anything here.',
    steps: [
      step(
        'src/main.tsx',
        'data-testid="deployment-configuration-error"',
        '**Failure 0: no backend.**\n\nA missing or malformed `VITE_CONVEX_URL` renders this panel rather than a blank page. If you see it, run `npx convex dev` — it provisions an anonymous local deployment and writes the variable into `.env.local`.',
      ),
      step(
        'convex/lib/nodeslideValidators.ts',
        'export function nodeslideCreatePublicError(',
        '**Failure 1: the request is refused.**\n\nEvery refusal carries a machine-readable `code` alongside its sentence, so the browser can branch on the code and still have something honest to show a human.\n\nGrep for a code you saw in a `ConvexError` and you land on the exact refusal.',
      ),
      step(
        'src/domains/nodeslide/nodeslideUserError.ts',
        'export function nodeSlideUserErrorMessage(',
        '**One place decides what a user sees.**\n\nInternal detail does not leak past here. The studio shows the result in a toast *and* an inline `role="alert"`, and — this matters — the typed input is preserved. A failed action never clears the composer.',
      ),
      step(
        'convex/nodeslide.ts',
        'export const recoverStaleAgentRunsInternal',
        "**Failure 2: the worker died mid-run.**\n\nAn agent run holds a lease. This mutation finds runs whose `leaseExpiresAt` has passed and fails them honestly, so a crashed action stops spinning in the UI instead of hanging forever.\n\n'Honestly' is the operative word: it marks them failed with a reason rather than quietly deleting them.",
      ),
      step(
        'convex/crons.ts',
        "'recover stale NodeSlide agent runs'",
        '**Recovery is scheduled, not hoped for.**\n\nEvery two minutes. That number is the worst case a user waits to be told their run died.\n\nThe other crons here prune expired traces, shadow comparisons and evidence captures — the retention story, on the same schedule mechanism.',
      ),
      step(
        'convex/nodeslideJobs.ts',
        'export const retry = mutation({',
        "**Failure 3: the user wants to try again.**\n\n`retry` and `cancel` operate on the durable job row, so they work after a page reload and after the original action's process is long gone.",
      ),
      step(
        'convex/nodeslideJobRunner.ts',
        'export const executeCreateDeckInternal',
        '**Where progress comes from.**\n\nThe runner calls `checkpointInternal` as it goes. Progress only ever moves forward (`Math.max(row.progress, args.progress)`), so a retried step cannot make the bar jump backwards.',
      ),
      step(
        'convex/nodeslideAgentRecovery.test.ts',
        'interrupts every open assistant stream when its worker lease expires',
        '**The test that proves recovery.**\n\nIt asserts the streams are actually interrupted, not merely that the row status changed — the failure mode is a run marked failed whose stream is still open.',
      ),
      step(
        'scripts/tests/workspace-build-depth.test.mjs',
        'finds no workspace build script that starts a fourth nested npm level',
        "**Failure 4: the build, on Windows.**\n\n`npm run build` used to die at the eleventh workspace with `'tsup' is not recognized`, although tsup was installed. It was not a missing tool: each nested `npm run` prepends about 1.4 KB of `.bin` paths to PATH, and a fourth level crossed the ~8,191-character ceiling `cmd.exe` will expand — past which cmd.exe hands the child an empty PATH and *nothing* resolves.\n\nThe header comment above has the full measurement. This test fails if anyone reintroduces the nesting.",
      ),
    ],
  },
];

const check = process.argv.includes('--check');
const drifted = [];
mkdirSync('.tours', { recursive: true });
for (const tour of tours) {
  const { path, ...body } = tour;
  const json = `${JSON.stringify({ $schema: 'https://aka.ms/codetour-schema', ...body }, null, 2)}\n`;
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== json) drifted.push(path);
  } else {
    writeFileSync(path, json);
  }
}

// Verify: every file exists and every line is inside it.
let checked = 0;
for (const tour of tours) {
  for (const s of tour.steps) {
    const total = readFileSync(s.file, 'utf8').split(/\r?\n/).length;
    if (s.line < 1 || s.line > total)
      throw new Error(`${tour.path}: ${s.file}:${s.line} out of range (${total})`);
    checked += 1;
  }
}
if (drifted.length) {
  console.error(
    `CodeTours no longer match the source they point at:\n  ${drifted.join('\n  ')}\nRun: node scripts/build-code-tours.mjs`,
  );
  process.exit(1);
}
console.log(
  `${check ? 'checked' : 'wrote'} ${tours.length} tours, ${checked} steps, all locations resolve`,
);
