import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getErrorMessage, searchNotes, semanticSearch } from '../api/files';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectFile: (path: string) => void;
}

type SearchMode = 'text' | 'semantic';

interface DisplayItem {
  key: string;
  path: string;
  title: string;
  subtitle: string;
  snippet: string;
  tags: string[];
  score?: number;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Quick-switcher / search overlay (Ctrl/Cmd-K). Two modes:
 * - Text: full-text + tag search (a leading `#` searches a tag).
 * - Semantic: relevance-ranked retrieval across note passages.
 */
export function SearchDialog({ open, onClose, onSelectFile }: SearchDialogProps) {
  const [mode, setMode] = useState<SearchMode>('text');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode('text');
      setQuery('');
      setItems([]);
      setActiveIndex(0);
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const next = await runSearch(mode, trimmed);
        if (!cancelled) {
          setItems(next);
          setActiveIndex(0);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(err));
          setItems([]);
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, mode, open]);

  if (!open) {
    return null;
  }

  function choose(item: DisplayItem | undefined) {
    if (item) {
      onSelectFile(item.path);
      onClose();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[activeIndex]);
    }
  }

  const placeholder =
    mode === 'semantic'
      ? 'Describe what you’re looking for…'
      : 'Search notes…  (prefix with # to search a tag)';

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
        <div className="search-dialog__modes" role="tablist" aria-label="Search mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'text'}
            className={mode === 'text' ? 'search-dialog__mode is-active' : 'search-dialog__mode'}
            onClick={() => setMode('text')}
          >
            Text
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'semantic'}
            className={
              mode === 'semantic' ? 'search-dialog__mode is-active' : 'search-dialog__mode'
            }
            onClick={() => setMode('semantic')}
          >
            Semantic
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          className="search-dialog__input"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error ? (
          <p className="search-dialog__empty">Search failed: {error}</p>
        ) : query.trim() && items.length === 0 ? (
          <p className="search-dialog__empty">No matches.</p>
        ) : (
          <ul className="search-dialog__results">
            {items.map((item, index) => (
              <li key={item.key}>
                <button
                  type="button"
                  className={
                    index === activeIndex
                      ? 'search-dialog__result is-active'
                      : 'search-dialog__result'
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(item)}
                >
                  <span className="search-dialog__result-name">
                    {item.title}
                    {item.score !== undefined ? (
                      <span className="search-dialog__result-score">{item.score.toFixed(2)}</span>
                    ) : null}
                  </span>
                  <span className="search-dialog__result-path">{item.subtitle}</span>
                  {item.snippet ? (
                    <span className="search-dialog__result-snippet">{item.snippet}</span>
                  ) : null}
                  {item.tags.length > 0 ? (
                    <span className="search-dialog__result-tags">
                      {item.tags.map((tag) => (
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

async function runSearch(mode: SearchMode, trimmed: string): Promise<DisplayItem[]> {
  if (mode === 'semantic') {
    const hits = await semanticSearch({ query: trimmed, limit: 20 });
    return hits.map((hit) => ({
      key: `${hit.path}#${hit.chunkIndex}`,
      path: hit.path,
      title: basename(hit.path),
      subtitle: hit.heading ? `${hit.path} › ${hit.heading}` : hit.path,
      snippet: hit.snippet,
      tags: [],
      score: hit.score,
    }));
  }

  const params = trimmed.startsWith('#') ? { tag: trimmed.slice(1) } : { query: trimmed };
  const matches = await searchNotes({ ...params, limit: 25 });
  return matches.map((match) => ({
    key: match.path,
    path: match.path,
    title: match.name,
    subtitle: match.path,
    snippet: match.snippet,
    tags: match.tags,
  }));
}
