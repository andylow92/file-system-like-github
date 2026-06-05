import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { GraphData, GraphNode } from '@repo/shared';
import { computeAdjacency, computeGraphLayout, tagHue } from './graphLayout';

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 720;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

interface KnowledgeGraphProps {
  graph: GraphData;
  onSelectFile: (path: string) => void;
  /** The currently-open note, highlighted in the graph. */
  selectedPath?: string | null;
}

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

function nodeFill(node: GraphNode): string {
  if (node.unresolved) {
    return 'var(--color-danger)';
  }
  if (node.tags.length > 0) {
    return `hsl(${tagHue(node.tags[0])} 58% 55%)`;
  }
  return 'var(--color-accent)';
}

/**
 * Render the vault's wikilink graph as an interactive, force-directed SVG.
 * Layout is computed deterministically (see `graphLayout`), so this component
 * is pure render + interaction: hover to highlight a node and its neighbors,
 * click a note to open it, pan/zoom to explore. Lazy-loaded so it stays out of
 * the main bundle.
 */
export function KnowledgeGraph({ graph, onSelectFile, selectedPath }: KnowledgeGraphProps) {
  const positions = useMemo(
    () => computeGraphLayout(graph, { width: VIEW_WIDTH, height: VIEW_HEIGHT }),
    [graph],
  );
  const adjacency = useMemo(() => computeAdjacency(graph), [graph]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: ViewTransform;
  } | null>(null);

  // Non-passive wheel listener so zoom can preventDefault the page scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((current) => {
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
        return { ...current, scale };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const highlightId = hoveredId;
  const isDimmed = (id: string): boolean => {
    if (!highlightId) {
      return false;
    }
    if (id === highlightId) {
      return false;
    }
    return !adjacency.get(highlightId)?.has(id);
  };

  function handleBackgroundPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    // Only start a pan when the background itself was grabbed (not a node).
    if (event.target !== event.currentTarget) {
      return;
    }
    panState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: view,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const pan = panState.current;
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    const unitsPerPxX = rect && rect.width > 0 ? VIEW_WIDTH / rect.width : 1;
    const unitsPerPxY = rect && rect.height > 0 ? VIEW_HEIGHT / rect.height : 1;
    setView({
      scale: pan.origin.scale,
      tx: pan.origin.tx + (event.clientX - pan.startX) * unitsPerPxX,
      ty: pan.origin.ty + (event.clientY - pan.startY) * unitsPerPxY,
    });
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (panState.current?.pointerId === event.pointerId) {
      panState.current = null;
    }
  }

  function adjustZoom(factor: number) {
    setView((current) => ({
      ...current,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor)),
    }));
  }

  return (
    <div className="graph-canvas">
      <div className="graph-controls" role="toolbar" aria-label="Graph zoom">
        <button
          type="button"
          className="graph-control-btn"
          onClick={() => adjustZoom(1.2)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="graph-control-btn"
          onClick={() => adjustZoom(1 / 1.2)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="graph-control-btn"
          onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
          aria-label="Reset view"
        >
          Reset
        </button>
      </div>
      <svg
        ref={svgRef}
        className="graph-svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Knowledge graph with ${graph.nodes.length} nodes`}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {graph.edges.map((edge) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (!a || !b) {
              return null;
            }
            const dim = isDimmed(edge.source) && isDimmed(edge.target);
            return (
              <line
                key={`${edge.source}->${edge.target}:${edge.type ?? ''}`}
                className={`graph-edge${edge.type ? ' graph-edge--typed' : ''}${dim ? ' graph-edge--dim' : ''}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
              >
                {edge.type ? <title>{edge.type}</title> : null}
              </line>
            );
          })}

          {graph.nodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) {
              return null;
            }
            const dim = isDimmed(node.id);
            const selected = node.id === selectedPath;
            const classes = [
              'graph-node',
              node.unresolved ? 'graph-node--unresolved' : '',
              selected ? 'graph-node--selected' : '',
              dim ? 'graph-node--dim' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <g
                key={node.id}
                className={classes}
                transform={`translate(${pos.x} ${pos.y})`}
                role={node.unresolved ? undefined : 'button'}
                tabIndex={node.unresolved ? undefined : 0}
                aria-label={node.unresolved ? `${node.label} (unresolved link)` : node.label}
                style={{ cursor: node.unresolved ? 'help' : 'pointer' }}
                onClick={() => {
                  if (!node.unresolved) {
                    onSelectFile(node.id);
                  }
                }}
                onKeyDown={(event) => {
                  if (!node.unresolved && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onSelectFile(node.id);
                  }
                }}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() =>
                  setHoveredId((current) => (current === node.id ? null : current))
                }
                onFocus={() => setHoveredId(node.id)}
                onBlur={() => setHoveredId((current) => (current === node.id ? null : current))}
              >
                <circle
                  className="graph-node__dot"
                  r={selected ? 10 : 7}
                  style={{ fill: nodeFill(node) }}
                />
                <text className="graph-node__label" x={11} y={4}>
                  {node.label}
                </text>
                <title>{node.id}</title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
