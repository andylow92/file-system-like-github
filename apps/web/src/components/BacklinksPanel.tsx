import { useEffect, useState } from 'react';
import type { Backlink } from '@repo/shared';
import { fetchBacklinks, getErrorMessage } from '../api/files';

interface BacklinksPanelProps {
  filePath: string | null;
  /** Changing this value forces a re-fetch (e.g. after the vault changes). */
  refreshKey?: string | number;
  onSelectFile: (path: string) => void;
}

export function BacklinksPanel({ filePath, refreshKey, onSelectFile }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setBacklinks([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBacklinks(filePath)
      .then((result) => {
        if (!cancelled) {
          setBacklinks(result);
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
  }, [filePath, refreshKey]);

  if (!filePath) {
    return null;
  }

  return (
    <section className="backlinks-panel" aria-label="Backlinks">
      <h2 className="backlinks-panel__title">
        Backlinks{backlinks.length > 0 ? ` (${backlinks.length})` : ''}
      </h2>
      {loading ? (
        <p className="backlinks-panel__empty">Loading backlinks…</p>
      ) : error ? (
        <p className="backlinks-panel__empty">Could not load backlinks: {error}</p>
      ) : backlinks.length === 0 ? (
        <p className="backlinks-panel__empty">No notes link here yet.</p>
      ) : (
        <ul className="backlinks-panel__list">
          {backlinks.map((backlink) => (
            <li key={backlink.path}>
              <button
                type="button"
                className="backlinks-panel__link"
                onClick={() => onSelectFile(backlink.path)}
              >
                <span className="backlinks-panel__name">{backlink.name}</span>
                <span className="backlinks-panel__path">{backlink.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
