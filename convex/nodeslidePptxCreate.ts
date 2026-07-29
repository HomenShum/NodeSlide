'use node';

import { v } from 'convex/values';
import {
  DEFAULT_PPTX_IMPORT_BOUNDS,
  importPptxSnapshot,
} from '../src/domains/nodeslide/slidelang/pptxImport';
import { internal } from './_generated/api';
import { action } from './_generated/server';
import { isOwnerAccessKey } from './lib/nodeslideAccess';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import { runNodeSlideLiveRenderRepair } from './lib/nodeslideLiveRenderRepair';

const MAX_PPTX_CREATE_BYTES = Math.min(8 * 1024 * 1024, DEFAULT_PPTX_IMPORT_BOUNDS.maxInputBytes);
const MAX_FIDELITY_NOTES = 12;

// Generated Convex references form a deliberate action -> mutation boundary.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const nodeslideInternal: any = (internal as any).nodeslide;

/**
 * Start from PowerPoint: a .pptx seeds a NEW deck, not only an edit to an
 * existing one.
 *
 * The archive is parsed server-side inside `importPptxSnapshot`'s hostile-input
 * bounds — this is a Node action precisely so the parser never runs in the
 * Convex default runtime — and the resulting snapshot then rides the same
 * persistence, validation, versioning and trace path as a brief-created deck
 * via `createImportedDeckInternal`.
 *
 * Every failure returns a coded, fidelity-annotated `ok: false`. It never falls
 * back to a placeholder deck: a user who hands over their own file and receives
 * a deck they did not import has been told something untrue about their data,
 * and the fidelity notes exist so that even a SUCCESSFUL import discloses what
 * it could not carry across.
 */
export const importPptxAsNewDeck = action({
  args: {
    clientSessionId: v.string(),
    ownerAccessKey: v.string(),
    idempotencyKey: v.string(),
    fileName: v.string(),
    bytes: v.bytes(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; deckId: string; slideCount: number; fidelityNotes: string[] }
    | { ok: false; code: string; message: string; fidelityNotes: string[] }
  > => {
    if (!isOwnerAccessKey(args.ownerAccessKey)) {
      return invalid('invalid_owner_key', 'Invalid NodeSlide owner access key.');
    }
    const fileName = args.fileName.trim().slice(0, 180);
    const idempotencyKey = args.idempotencyKey.trim();
    if (!fileName.toLowerCase().endsWith('.pptx')) {
      return invalid('unsupported_format', 'Start-from-PowerPoint needs a .pptx file.');
    }
    if (!idempotencyKey || idempotencyKey.length > 160 || args.clientSessionId.length > 256) {
      return invalid('invalid_request', 'The import request identifiers are out of bounds.');
    }
    if (args.bytes.byteLength === 0 || args.bytes.byteLength > MAX_PPTX_CREATE_BYTES) {
      return invalid(
        'archive_too_large',
        `PPTX imports accept up to ${Math.floor(MAX_PPTX_CREATE_BYTES / (1024 * 1024))} MB.`,
      );
    }

    const contentDigest = nodeslideContentDigest(
      `${args.clientSessionId}:${idempotencyKey}:${args.bytes.byteLength}`,
    );
    const deckId = nodeslideStableId('deck_pptx_import', contentDigest);
    const projectId = nodeslideStableId('project_pptx_import', contentDigest);

    const imported = await importPptxSnapshot(args.bytes, {
      deckId,
      projectId,
      fileName,
      timestamp: Date.now(),
    });
    const fidelityNotes = fidelitySummaries(imported.fidelity);
    if (!imported.ok) {
      return {
        ok: false,
        code: imported.error.code,
        message: imported.error.message.slice(0, 300),
        fidelityNotes,
      };
    }

    // The render-repair loop runs over the imported deck BEFORE it is persisted,
    // fixing the automatic classes (geometry clamps, text fit, contrast).
    // Whatever remains persists as visible findings: the import is never refused
    // for repairable layout, and never silently "cleaned" without a note.
    let candidate = imported.snapshot;
    const repairNotes: string[] = [];
    try {
      const repair = runNodeSlideLiveRenderRepair(imported.snapshot);
      candidate = repair.result.candidate;
      repairNotes.push(
        `Render repair: ${repair.summary.status} (${repair.summary.terminalReason}) after ${repair.summary.attempts} attempt${repair.summary.attempts === 1 ? '' : 's'}`,
        ...repair.summary.receipts.map(
          (receipt) => `Repair attempt ${receipt.attempt}: ${receipt.status}`,
        ),
      );
    } catch {
      // A repair pass that throws must not lose the user's import. It also must
      // not claim a pass that did not happen, so the note says so and the
      // unrepaired snapshot is what gets persisted.
      repairNotes.push('Render repair: pass did not complete; importing as-is.');
    }

    try {
      await ctx.runMutation(nodeslideInternal.createImportedDeckInternal, {
        clientSessionId: args.clientSessionId,
        ownerAccessKey: args.ownerAccessKey,
        snapshot: candidate,
        fileName,
        fidelityNotes: [...fidelityNotes, ...repairNotes].slice(0, MAX_FIDELITY_NOTES * 2),
      });
    } catch (error) {
      // The creation path is shared with brief-created decks, and it holds a
      // gate parity's does not: `assertNodeSlideArtifactCompilation` refuses a
      // chart artifact that retains no canonical evidence source. A .pptx has
      // nowhere to encode NodeSlide's source bindings, so an imported chart
      // always arrives unevidenced and this refusal is reachable by any real
      // archive containing one.
      //
      // The gate is correct and is NOT relaxed here: a chart nobody can trace to
      // a source is the exact claim this deployment refuses to persist. What was
      // wrong is the shape of the refusal — the mutation throws, and an action
      // whose entire contract is "coded, fidelity-annotated results, never a
      // silent fallback deck" was ending in an opaque server error that told the
      // user neither what failed nor that their file was the reason.
      return {
        ok: false,
        code: 'unsupported_content',
        message: refusalMessage(error),
        fidelityNotes,
      };
    }
    return {
      ok: true,
      deckId,
      slideCount: candidate.slides.length,
      fidelityNotes,
    };
  },
});

function invalid(
  code: string,
  message: string,
): { ok: false; code: string; message: string; fidelityNotes: string[] } {
  return { ok: false, code, message, fidelityNotes: [] };
}

/**
 * Forwards the persistence gate's own reason, bounded.
 *
 * The gate names the artifact and the rule it broke; replacing that with a
 * generic "import failed" would leave the user guessing which of their slides
 * to change. A non-Error rejection gets a fixed sentence rather than a coerced
 * one, because interpolating an unknown value into a user-facing message is how
 * an internal detail escapes.
 */
function refusalMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `This PowerPoint could not be imported as a deck: ${error.message}`.slice(0, 300);
  }
  return 'This PowerPoint could not be imported as a deck.';
}

function fidelitySummaries(
  report: { items?: readonly { feature?: string; reason?: string }[] } | undefined,
) {
  return (report?.items ?? [])
    .flatMap((item) =>
      item.reason ? [`${item.feature ?? 'import'}: ${item.reason}`.slice(0, 160)] : [],
    )
    .slice(0, MAX_FIDELITY_NOTES);
}
