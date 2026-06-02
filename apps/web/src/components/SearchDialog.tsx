import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SearchMatch } from '@repo/shared';
import { getErrorMessage, searchNotes } from '../api/files';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectFile: (path: string) => void;
}

/**
 * Quick-switcher / full-text search overlay (Ctrl/Cmd-K). Searches note bodies
 * and tags via the API. A leading `#` in the query is treated as a tag filter.
 */
export function SearchDialog({ open, onClose, onSelectFile }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      setError(null);
      // Focus after the dialog paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const params = trimmed.startsWith('#') ? { tag: trimmed.slice(1) } : { query: trimmed };
        const found = await searchNotes({ ...params, limit: 25 });
        if (!cancelled) {
          setResults(found);
          setActiveIndex(0);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(err));
          setResults([]);
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, open]);

  if (!open) {
    return null;
  }

  function choose(match: SearchMatch | undefined) {
    if (match) {
      onSelectFile(match.path);
      onClose();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  }

  return (
    <div
      className="search-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="search-dialog" role="dialog" aria-label="Search notes" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          type="text"
          className="search-dialog__input"
          placeholder="Search notes…  (prefix with # to search a tag)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error ? (
          <p className="search-dialog__empty">Search failed: {error}</p>
        ) : query.trim() && results.length === 0 ? (
          <p className="search-dialog__empty">No matches.</p>
        ) : (
          <ul className="search-dialog__results">
            {results.map((match, index) => (
              <li key={match.path}>
                <button
                  type="button"
                  className={
                    index === activeIndex
                      ? 'search-dialog__result is-active'
                      : 'search-dialog__result'
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(match)}
                >
                  <span className="search-dialog__result-name">{match.name}</span>
                  <span className="search-dialog__result-path">{match.path}</span>
                  {match.snippet ? (
                    <span className="search-dialog__result-snippet">{match.snippet}</span>
                  ) : null}
                  {match.tags.length > 0 ? (
                    <span className="search-dialog__result-tags">
                      {match.tags.map((tag) => (
                        <span key={tag} className="tag-chip">
                          #{tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
