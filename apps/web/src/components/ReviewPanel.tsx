import { useEffect, useState } from 'react';
import type { EditProposal } from '@repo/shared';
import { fetchFile, fetchProposals, getErrorMessage, resolveProposal } from '../api/files';

interface ReviewPanelProps {
  /** Changing this forces a refresh. */
  refreshKey?: string | number;
  /** Called after a proposal is approved/rejected (to refresh tree + activity). */
  onResolved?: () => void;
  onSelectFile: (path: string) => void;
}

const ACTION_VERB: Record<EditProposal['action'], string> = {
  create: 'create',
  update: 'update',
  delete: 'delete',
};

/**
 * Human review queue for agent-proposed edits. Shows each pending proposal with
 * a before/after diff and Approve/Reject controls. Approving applies the edit
 * (attributed to the proposing agent in the audit log); rejecting discards it.
 */
export function ReviewPanel({ refreshKey, onResolved, onSelectFile }: ReviewPanelProps) {
  const [proposals, setProposals] = useState<EditProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProposals('pending')
      .then((result) => {
        if (!cancelled) {
          setProposals(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, reloadKey]);

  async function handleResolve(id: string, decision: 'approve' | 'reject') {
    await resolveProposal(id, decision);
    setReloadKey((value) => value + 1);
    onResolved?.();
  }

  if (loading) {
    return <p className="empty-state">Loading proposals…</p>;
  }
  if (error) {
    return <p className="empty-state">Could not load proposals: {error}</p>;
  }
  if (proposals.length === 0) {
    return <p className="empty-state">No proposals awaiting review.</p>;
  }

  return (
    <ul className="review-list" aria-label="Edit proposals">
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          onResolve={handleResolve}
          onSelectFile={onSelectFile}
        />
      ))}
    </ul>
  );
}

interface ProposalCardProps {
  proposal: EditProposal;
  onResolve: (id: string, decision: 'approve' | 'reject') => Promise<void>;
  onSelectFile: (path: string) => void;
}

function ProposalCard({ proposal, onResolve, onSelectFile }: ProposalCardProps) {
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // For update/delete, load the file's current content to show the "before".
  useEffect(() => {
    if (proposal.action === 'create') {
      return;
    }
    let cancelled = false;
    fetchFile(proposal.path)
      .then((file) => {
        if (!cancelled) {
          setCurrent(file.content);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrent(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [proposal.path, proposal.action]);

  async function resolve(decision: 'approve' | 'reject') {
    setBusy(true);
    setActionError(null);
    try {
      await onResolve(proposal.id, decision);
    } catch (err: unknown) {
      setActionError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <li className="review-item">
      <div className="review-item__head">
        <span className="actor-badge actor-badge--agent">{proposal.actor}</span>
        <span className="review-item__action">{ACTION_VERB[proposal.action]}</span>
        <button
          type="button"
          className="review-item__path"
          onClick={() => onSelectFile(proposal.path)}
        >
          {proposal.path}
        </button>
      </div>
      {proposal.note ? <p className="review-item__note">{proposal.note}</p> : null}

      <div className="review-item__diff">
        {proposal.action !== 'create' ? (
          <div className="review-pane">
            <h4>Current</h4>
            <pre>{current ?? '(unable to load current content)'}</pre>
          </div>
        ) : null}
        {proposal.action !== 'delete' ? (
          <div className="review-pane">
            <h4>Proposed</h4>
            <pre>{proposal.content ?? ''}</pre>
          </div>
        ) : null}
      </div>

      {actionError ? <p className="review-item__error">{actionError}</p> : null}
      <div className="review-item__actions">
        <button
          type="button"
          className="danger-btn"
          disabled={busy}
          onClick={() => void resolve('reject')}
        >
          Reject
        </button>
        <button
          type="button"
          className="save-button"
          disabled={busy}
          onClick={() => void resolve('approve')}
        >
          Approve
        </button>
      </div>
    </li>
  );
}
