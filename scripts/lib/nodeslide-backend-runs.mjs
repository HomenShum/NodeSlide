/**
 * Which backend runs did one browser session cause, and what did the budget ledger charge for them?
 *
 * The campaign runners (`run-deck-gym.mjs`, `run-node-gym.mjs` via the UI executor) drive the
 * production site in a fresh browser context per run, so every backend job in that context's client
 * session belongs to that run. The ledger (`nodeslideBudgets.receiptForRun`) is the meter; this
 * module only finds the run ids and reads the receipts. It never reads cost from the Trace inspector.
 */

export const NODESLIDE_SESSION_ID_STORAGE_KEY = 'parity.studio.sessionId';
const MAX_BACKEND_RUN_IDS = 64;

export function productionConvexUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname.endsWith('.convex.cloud')
  )
    throw new Error('Convex URL must be a clean production Convex HTTPS URL.');
  return url;
}

/** The two Convex reads the runners need, bound to a production deployment. */
export async function createNodeSlideBackendClient(convexUrl) {
  const [{ ConvexHttpClient }, { api }] = await Promise.all([
    import('convex/browser'),
    import('../../convex/_generated/api.js'),
  ]);
  const client = new ConvexHttpClient(productionConvexUrl(convexUrl).origin);
  return {
    listSessionJobs: (clientSessionId) =>
      client.query(api.nodeslideJobs.listSessionJobs, { clientSessionId }),
    receiptForRun: (runId) => client.query(api.nodeslideBudgets.receiptForRun, { runId }),
  };
}

/**
 * Backend run ids (job ids) the page's client session caused. Returns [] when the session id cannot
 * be read or the list cannot be fetched: the caller then treats usage as unknown and keeps the
 * run's full reservation.
 */
export async function readBackendRunIds({ page, backend }) {
  try {
    const clientSessionId = await page.evaluate((key) => {
      try {
        return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key) ?? '';
      } catch {
        return '';
      }
    }, NODESLIDE_SESSION_ID_STORAGE_KEY);
    if (typeof clientSessionId !== 'string' || !clientSessionId) return [];
    const jobs = await backend.listSessionJobs(clientSessionId);
    if (!Array.isArray(jobs)) return [];
    return [
      ...new Set(
        jobs
          .map((job) => job?.jobId)
          .filter((jobId) => typeof jobId === 'string' && jobId.length > 0 && jobId.length <= 512),
      ),
    ].slice(0, MAX_BACKEND_RUN_IDS);
  } catch {
    return [];
  }
}

/** Ledger receipts keyed by run id; a read that fails or finds no row is stored as null (unknown). */
export async function readLedgerReceipts({ backend, runIds }) {
  const receipts = new Map();
  for (const runId of runIds ?? []) {
    try {
      receipts.set(runId, (await backend.receiptForRun(runId)) ?? null);
    } catch {
      receipts.set(runId, null);
    }
  }
  return receipts;
}
