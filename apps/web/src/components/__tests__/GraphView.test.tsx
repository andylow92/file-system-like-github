import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphData } from '@repo/shared';
import { GraphView } from '../GraphView';
import { fetchGraph } from '../../api/files';

// Partially mock the API client so the Graph view renders from a fixed graph
// instead of hitting the network; keep the real `getErrorMessage`.
vi.mock('../../api/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/files')>();
  return { ...actual, fetchGraph: vi.fn() };
});

const graph: GraphData = {
  nodes: [
    { id: 'alpha.md', label: 'alpha', tags: ['topic'] },
    { id: 'beta.md', label: 'beta', tags: [] },
    { id: 'ghost', label: 'ghost', tags: [], unresolved: true },
  ],
  edges: [
    { source: 'alpha.md', target: 'beta.md' },
    { source: 'alpha.md', target: 'ghost' },
  ],
};

describe('GraphView', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders graph nodes from /api/graph and opens a note when a node is clicked', async () => {
    vi.mocked(fetchGraph).mockResolvedValue(graph);
    const onSelectFile = vi.fn();

    render(<GraphView refreshKey={0} onSelectFile={onSelectFile} />);

    // Resolved notes render as accessible buttons labelled by their basename.
    const betaNode = await screen.findByRole('button', { name: 'beta' });
    expect(screen.getByRole('button', { name: 'alpha' })).toBeInTheDocument();

    fireEvent.click(betaNode);
    expect(onSelectFile).toHaveBeenCalledWith('beta.md');
  });

  it('renders an unresolved link target as a non-clickable placeholder', async () => {
    vi.mocked(fetchGraph).mockResolvedValue(graph);

    render(<GraphView refreshKey={0} onSelectFile={vi.fn()} />);

    await screen.findByRole('button', { name: 'alpha' });
    expect(screen.queryByRole('button', { name: 'ghost' })).toBeNull();
    expect(screen.getByLabelText('ghost (unresolved link)')).toBeInTheDocument();
  });
});
