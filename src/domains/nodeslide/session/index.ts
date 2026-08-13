/**
 * What the rest of the app is allowed to know about the agent session.
 *
 * An "agent session" is one person's live conversation with the NodeSlide
 * agent about one deck: which model they picked, what they attached, whether
 * they pre-approved edits, and which background job is currently running for
 * them. Everything about how that is stored, reconciled after a page reload,
 * or written to session storage lives inside this folder and is nobody else's
 * business.
 *
 * Only what a file outside `session/` actually imports is re-exported here.
 * A barrel that lists every internal helper reads like an API and behaves like
 * a trap: the next person assumes the helpers are supported entry points and
 * calls them from the editor, and session bookkeeping leaks into UI code.
 * Add a line here when a real caller appears, not in advance.
 */
export {
  AgentSessionProvider,
  createAgentSessionSecret,
  useOptionalAgentSession,
} from './AgentSessionProvider';
export type {
  AgentSessionAttachment,
  AgentSessionJobHandle,
  AgentSessionJobReceipt,
} from './types';
