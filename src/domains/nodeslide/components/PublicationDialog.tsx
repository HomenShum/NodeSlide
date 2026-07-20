import { ClipboardCopy, Link2, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NodeSlidePublication } from '../../../../shared/nodeslide';

export interface PublishApprovalView {
  required: boolean;
  deckVersion: number;
  approvers: Array<{ approverId: string; label: string; issuedAt?: number; revoked: boolean }>;
  currentVersionApprovals: Array<{ approverId: string; approvedAt: number }>;
}

interface PublicationDialogProps {
  open: boolean;
  publication: NodeSlidePublication | null;
  shareUrl: string | null;
  currentDeckVersion: number;
  busy: boolean;
  /** D9 governance state + actions; omitted while the approval query loads. */
  approval?: PublishApprovalView | undefined;
  issuedApproverToken?: { label: string; token: string } | null | undefined;
  /** Link to the dedicated non-owner review surface (?approve=<deckId>). */
  approverReviewUrl?: string | null | undefined;
  onToggleApprovalRequired?: ((required: boolean) => Promise<void> | void) | undefined;
  onIssueApprover?: ((label: string) => Promise<void> | void) | undefined;
  onRevokeApprover?: ((approverId: string) => Promise<void> | void) | undefined;
  onApproveWithToken?:
    | ((token: string, reviewedDeckVersion: number) => Promise<void> | void)
    | undefined;
  onClose: () => void;
  onCopy: () => void;
  onPublish: () => void;
  onRevoke: () => void;
}

export function PublicationDialog({
  open,
  publication,
  shareUrl,
  currentDeckVersion,
  busy,
  approval,
  issuedApproverToken = null,
  approverReviewUrl = null,
  onToggleApprovalRequired,
  onIssueApprover,
  onRevokeApprover,
  onApproveWithToken,
  onClose,
  onCopy,
  onPublish,
  onRevoke,
}: PublicationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [approverName, setApproverName] = useState('');
  const [approverToken, setApproverToken] = useState('');
  // The version an approver signs off must be PINNED when they begin reviewing (first token
  // entry), never read live from the reactive approval query at click time — otherwise a
  // concurrent owner edit advancing the deck silently re-targets the attestation to a newer,
  // unreviewed version and the server CAS (which compares against the current version) passes.
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  // One approval mutation in flight at a time. Every governance control disables while an
  // action runs, so a double-click can never double-issue an approver (each success
  // overwrites the shown-once token, orphaning the first) or double-submit a sign-off.
  const [pendingApproval, setPendingApproval] = useState<
    null | 'toggle' | 'issue' | 'revoke' | 'sign_off'
  >(null);
  const runApprovalAction = (
    kind: 'toggle' | 'issue' | 'revoke' | 'sign_off',
    action: () => Promise<void> | void,
  ) => {
    if (pendingApproval !== null) return;
    setPendingApproval(kind);
    void Promise.resolve()
      .then(action)
      .finally(() => setPendingApproval(null));
  };
  const active = publication?.status === 'active';
  const current = active && publication.deckVersion === currentDeckVersion;
  const governanceReady = approval !== undefined && onToggleApprovalRequired !== undefined;
  const approvedForCurrent = (approval?.currentVersionApprovals.length ?? 0) > 0;
  const approverLabelById = new Map(
    (approval?.approvers ?? []).map((entry) => [entry.approverId, entry.label]),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => primaryRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  // Clear the pasted approver capability — a bearer secret — plus the pinned version and
  // draft name whenever the dialog closes, matching the "shown once, cleared on close"
  // hygiene given to the issued token. Local state survives close because only the native
  // dialog's open attribute toggles, never this component's mount.
  useEffect(() => {
    if (!open) {
      setApproverToken('');
      setReviewedVersion(null);
      setApproverName('');
    }
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={dialogRef}
      className="ns-share-dialog"
      aria-labelledby="ns-share-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <span aria-hidden="true">
          <Link2 size={20} />
        </span>
        <div>
          <small>View-only publication</small>
          <h1 id="ns-share-dialog-title">Share a frozen, validated deck</h1>
        </div>
        <button
          className="ns-icon-button"
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close share dialog"
        >
          <X size={16} />
        </button>
      </header>
      <div className="ns-share-dialog-body">
        <p>
          A share link opens an immutable snapshot. Speaker notes, the creation brief, private
          project context, and non-public sources are excluded.
        </p>
        <div className={`ns-share-status ${active ? 'is-active' : ''}`}>
          <ShieldCheck size={17} aria-hidden="true" />
          <span>
            <strong>
              {current
                ? `Version ${publication.deckVersion} is published`
                : active
                  ? `Version ${publication.deckVersion} remains published`
                  : publication?.status === 'revoked'
                    ? 'The previous link is revoked'
                    : 'No public link exists yet'}
            </strong>
            <small>
              {current
                ? 'Later edits will not change this link until you publish again.'
                : active
                  ? `Your editor is now version ${currentDeckVersion}; the existing link has not changed.`
                  : 'Publishing requires the current version to pass the server validation gate.'}
            </small>
          </span>
        </div>
        {governanceReady ? (
          <section className="ns-share-approval" data-testid="publish-approval-section">
            <label className="ns-share-approval-toggle">
              <input
                type="checkbox"
                checked={approval.required}
                disabled={busy || pendingApproval !== null}
                onChange={(event) => {
                  const next = event.currentTarget.checked;
                  runApprovalAction('toggle', () => onToggleApprovalRequired?.(next));
                }}
                aria-label="Require approver sign-off before publishing"
              />
              <span>
                <strong>Require approver sign-off</strong>
                <small>
                  When on, publishing v{approval.deckVersion} needs a sign-off from an approver
                  capability — a separate role the server checks on every publish.
                </small>
              </span>
            </label>
            {approval.required ? (
              <>
                <div
                  className={`ns-share-approval-state ${approvedForCurrent ? 'is-approved' : ''}`}
                >
                  {approvedForCurrent
                    ? `v${approval.deckVersion} signed off by ${approval.currentVersionApprovals
                        .map((entry) => approverLabelById.get(entry.approverId) ?? entry.approverId)
                        .join(', ')}`
                    : `Awaiting sign-off for v${approval.deckVersion}.`}
                </div>
                {approval.approvers.length > 0 ? (
                  <ul className="ns-share-approval-approvers">
                    {approval.approvers.map((entry) => (
                      <li key={entry.approverId}>
                        <span>{entry.label}</span>
                        {entry.revoked ? (
                          <small>revoked</small>
                        ) : (
                          <button
                            type="button"
                            disabled={busy || pendingApproval !== null}
                            onClick={() =>
                              runApprovalAction('revoke', () =>
                                onRevokeApprover?.(entry.approverId),
                              )
                            }
                          >
                            {pendingApproval === 'revoke' ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="ns-share-approval-row">
                  <input
                    type="text"
                    value={approverName}
                    placeholder="Approver name"
                    maxLength={80}
                    disabled={busy}
                    aria-label="New approver name"
                    onChange={(event) => setApproverName(event.currentTarget.value)}
                  />
                  <button
                    className="ns-button ns-button--quiet"
                    type="button"
                    disabled={busy || pendingApproval !== null || approverName.trim().length === 0}
                    onClick={() => {
                      const label = approverName.trim();
                      runApprovalAction('issue', () => onIssueApprover?.(label));
                      setApproverName('');
                    }}
                  >
                    {pendingApproval === 'issue' ? 'Issuing…' : 'Issue approver'}
                  </button>
                </div>
                {issuedApproverToken ? (
                  <div className="ns-share-approval-token" data-testid="issued-approver-token">
                    <strong>{issuedApproverToken.label}'s capability — shown once:</strong>
                    <input
                      type="text"
                      readOnly
                      value={issuedApproverToken.token}
                      onFocus={(event) => event.currentTarget.select()}
                      aria-label="Approver capability token"
                    />
                    <small>
                      Share it with the approver over a trusted channel. Only its digest is stored;
                      this dialog will not show it again.
                    </small>
                    {approverReviewUrl ? (
                      <>
                        <input
                          type="text"
                          readOnly
                          value={approverReviewUrl}
                          onFocus={(event) => event.currentTarget.select()}
                          aria-label="Approver review link"
                          data-testid="approver-review-link"
                        />
                        <small>
                          Send this review link too — the approver reads the slides and signs off
                          there, no owner access involved. Send link and capability through separate
                          channels.
                        </small>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {!approvedForCurrent ? (
                  <div className="ns-share-approval-row">
                    <input
                      type="password"
                      value={approverToken}
                      placeholder="Paste an approver capability to sign off"
                      disabled={busy}
                      aria-label="Approver capability token to sign off"
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setApproverToken(value);
                        // Pin the reviewed version on first token entry; release it when the
                        // field is cleared so a fresh review re-pins to the current version.
                        setReviewedVersion((prev) =>
                          value.trim().length === 0 ? null : (prev ?? approval.deckVersion),
                        );
                      }}
                    />
                    <button
                      className="ns-button ns-button--quiet"
                      type="button"
                      disabled={
                        busy ||
                        pendingApproval !== null ||
                        approverToken.trim().length === 0 ||
                        (reviewedVersion !== null && reviewedVersion !== approval.deckVersion)
                      }
                      onClick={() => {
                        // Sign off the PINNED reviewed version, not the live query value, so the
                        // server rejects it if the deck advanced past what the approver reviewed.
                        const token = approverToken.trim();
                        const version = reviewedVersion ?? approval.deckVersion;
                        runApprovalAction('sign_off', () => onApproveWithToken?.(token, version));
                        setApproverToken('');
                        setReviewedVersion(null);
                      }}
                    >
                      {pendingApproval === 'sign_off'
                        ? 'Signing off…'
                        : `Sign off v${reviewedVersion ?? approval.deckVersion}`}
                    </button>
                    {reviewedVersion !== null && reviewedVersion !== approval.deckVersion ? (
                      <div className="ns-share-approval-drift" role="alert">
                        The deck advanced to v{approval.deckVersion} while you were reviewing v
                        {reviewedVersion}. Clear the field and review the current version.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}
        {active && shareUrl ? (
          <label className="ns-share-url">
            View-only link
            <input
              type="url"
              value={shareUrl}
              readOnly
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Published view-only link"
            />
          </label>
        ) : null}
      </div>
      <footer>
        {active ? (
          <button
            ref={current ? primaryRef : undefined}
            className="ns-button ns-button--quiet"
            type="button"
            onClick={onCopy}
            disabled={busy}
          >
            <ClipboardCopy size={15} /> Copy existing link
          </button>
        ) : null}
        {!current ? (
          <button
            ref={primaryRef}
            className="ns-button ns-button--accent"
            type="button"
            onClick={onPublish}
            disabled={busy}
          >
            {busy ? <LoaderCircle className="ns-spin" size={15} /> : <Link2 size={15} />}
            {active ? 'Publish current version & copy' : 'Publish & copy link'}
          </button>
        ) : null}
        {active ? (
          <button
            className="ns-button ns-button--danger"
            type="button"
            onClick={onRevoke}
            disabled={busy}
          >
            <Trash2 size={15} /> Revoke link
          </button>
        ) : null}
      </footer>
    </dialog>
  );
}
