import { useEffect, useState } from 'react';
import type { AuditAction, AuditEntry } from '@repo/shared';
import { fetchAudit, getErrorMessage } from '../api/files';

interface ActivityPanelProps {
  /** Changing this forces a refresh (e.g. after a save). */
  refreshKey?: string | number;
  onSelectFile: (path: string) => void;
}

const ACTION_LABEL: Record<AuditAction, string> = {
  create: 'created',
  update: 'updated',
  move: 'moved',
  delete: 'deleted',
  create_dir: 'created folder',
};

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return ts;
  }
  return date.toLocaleString();
}

function actorClass(actor: string): string {
  return actor.startsWith('agent') ? 'actor-badge actor-badge--agent' : 'actor-badge';
}

/**
 * Human-facing provenance feed. Shows who changed what across the vault,
 * distinguishing human edits from agent edits via the actor badge.
 */
export function ActivityPanel({ refreshKey, onSelectFile }: ActivityPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAudit({ limit: 100 })
      .then((result) => {
        if (!cancelled) {
          setEntries(result);
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
  }, [refreshKey]);

  if (loading) {
    return <p className="empty-state">Loading activity…</p>;
  }

  if (error) {
    return <p className="empty-state">Could not load activity: {error}</p>;
  }

  if (entries.length === 0) {
    return <p className="empty-state">No changes recorded yet.</p>;
  }

  return (
    <ul className="activity-feed" aria-label="Vault activity">
      {entries.map((entry, index) => (
        <li key={`${entry.ts}-${index}`} className="activity-item">
          <span className={actorClass(entry.actor)}>{entry.actor}</span>
          <span className="activity-item__body">
            <span className="activity-item__action">{ACTION_LABEL[entry.action]}</span>{' '}
            <button
              type="button"
              className="activity-item__path"
              onClick={() => onSelectFile(entry.toPath ?? entry.path)}
            >
              {entry.toPath ?? entry.path}
            </button>
            {entry.action === 'move' ? (
              <span className="activity-item__from"> (from {entry.path})</span>
            ) : null}
          </span>
          <time className="activity-item__time" dateTime={entry.ts}>
            {formatTimestamp(entry.ts)}
          </time>
        </li>
      ))}
    </ul>
  );
}
