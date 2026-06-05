import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { GraphData } from '@repo/shared';
import { fetchGraph, getErrorMessage } from '../api/files';

// The graph renderer (SVG + force layout) is code-split so it stays out of the
// main bundle, mirroring the lazy-loaded markdown preview.
const KnowledgeGraph = lazy(() =>
  import('./KnowledgeGraph').then((module) => ({ default: module.KnowledgeGraph })),
);

// Coalesce rapid live changes (a burst of agent writes) into one rebuild.
const REFRESH_DEBOUNCE_MS = 250;

interface GraphViewProps {
  onSelectFile: (path: string) => void;
  /** Bumped on any vault change so the graph refreshes live. */
  refreshKey: number;
  /** The currently-open note, highlighted in the graph. */
  selectedPath?: string | null;
}

export function GraphView({ onSelectFile, refreshKey, selectedPath }: GraphViewProps) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchGraph()
        .then((data) => {
          if (!cancelled) {
            setGraph(data);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(getErrorMessage(err));
          }
        });
    };

    // Load immediately on first mount; debounce live refreshes after that.
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      load();
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(load, REFRESH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshKey]);

  if (error) {
    return (
      <div className="graph-view">
        <p className="empty-state">Could not load the graph: {error}</p>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="graph-view">
        <p className="empty-state" aria-live="polite">
          Building graph…
        </p>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="graph-view">
        <p className="empty-state">
          No notes yet — create a note and add [[wikilinks]] to see the graph.
        </p>
      </div>
    );
  }

  return (
    <div className="graph-view">
      <Suspense fallback={<p className="empty-state">Loading graph…</p>}>
        <KnowledgeGraph graph={graph} onSelectFile={onSelectFile} selectedPath={selectedPath} />
      </Suspense>
    </div>
  );
}
