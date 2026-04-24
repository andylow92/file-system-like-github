import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalLayout } from '../GlobalLayout';

describe('GlobalLayout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const tree = [
    {
      name: 'docs',
      path: 'docs',
      isDirectory: true,
      children: [
        {
          name: 'nested',
          path: 'docs/nested',
          isDirectory: true,
          children: [{ name: 'intro.md', path: 'docs/nested/intro.md', isDirectory: false }],
        },
      ],
    },
  ];

  function renderLayout() {
    const onRenamePath = vi.fn(async () => {});
    const view = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GlobalLayout
          tree={tree}
          onSelectFile={vi.fn()}
          onCreateFile={vi.fn(async () => {})}
          onCreateFolder={vi.fn(async () => {})}
          onRenamePath={onRenamePath}
          onDeletePath={vi.fn(async () => {})}
          onSave={vi.fn(async () => {})}
        >
          <div>Editor Panel</div>
        </GlobalLayout>
      </MemoryRouter>,
    );

    return { ...view, onRenamePath };
  }

  // -------------------------------------------------------------------------
  // Drag-and-drop (existing tests)
  // -------------------------------------------------------------------------

  it('renders tree rows as non-draggable and exposes drag handles', () => {
    renderLayout();

    const folderRow = screen.getByRole('treeitem', { name: 'docs' });
    expect(folderRow).not.toHaveAttribute('draggable');
    expect(folderRow).toHaveAttribute('data-kind', 'directory');

    const fileRow = screen.getByRole('treeitem', { name: 'intro.md' });
    expect(fileRow).not.toHaveAttribute('draggable');
    expect(fileRow).toHaveAttribute('data-kind', 'file');
    expect(fileRow).toHaveAttribute('data-path', 'docs/nested/intro.md');

    expect(screen.getByTitle('Drag docs')).toHaveAttribute('draggable', 'true');
    expect(screen.getByTitle('Drag intro.md')).toHaveAttribute('draggable', 'true');
  });

  it('shows an error toast when drop source path is missing', () => {
    renderLayout();

    const docsRow = screen.getByRole('treeitem', { name: 'docs' });
    fireEvent.drop(docsRow, {
      dataTransfer: {
        getData: () => '',
      },
    });

    expect(screen.getByText('Could not determine dragged item. Try again.')).toBeInTheDocument();
  });

  it('shows an info toast and does not rename when dropping on a file row', () => {
    const { onRenamePath } = renderLayout();

    const introRow = screen.getByRole('treeitem', { name: 'intro.md' });
    fireEvent.drop(introRow, {
      dataTransfer: {
        getData: () => 'docs/nested/intro.md',
      },
    });

    expect(screen.getByText('Drop onto a folder.')).toBeInTheDocument();
    expect(onRenamePath).not.toHaveBeenCalled();
  });

  it('calls onRenamePath when dropping on a folder row', async () => {
    const { onRenamePath } = renderLayout();

    const docsRow = screen.getByRole('treeitem', { name: 'docs' });
    fireEvent.drop(docsRow, {
      dataTransfer: {
        getData: () => 'docs/nested/intro.md',
      },
    });

    await waitFor(() =>
      expect(onRenamePath).toHaveBeenCalledWith('docs/nested/intro.md', 'docs/intro.md'),
    );
  });

  it('shows an error toast when moving a folder into itself', () => {
    renderLayout();

    const nestedRow = screen.getByRole('treeitem', { name: 'nested' });
    fireEvent.drop(nestedRow, {
      dataTransfer: {
        getData: () => 'docs',
      },
    });

    expect(screen.getAllByText('Cannot move a folder into itself.').length).toBeGreaterThan(0);
    expect(screen.getByRole('treeitem', { name: 'docs' })).toBeInTheDocument();
  });

  it('shows an info toast and does not rename when dropping onto same parent folder', async () => {
    const { onRenamePath } = renderLayout();

    // intro.md is already inside docs/nested; dropping it onto docs/nested is a no-op
    const nestedRow = screen.getByRole('treeitem', { name: 'nested' });
    fireEvent.drop(nestedRow, {
      dataTransfer: {
        getData: () => 'docs/nested/intro.md',
      },
    });

    expect(screen.getByText('Item is already in that folder.')).toBeInTheDocument();
    expect(onRenamePath).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Sidebar collapse / expand
  // -------------------------------------------------------------------------

  it('renders a collapse button and hides sidebar content on click', () => {
    renderLayout();

    const collapseBtn = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapseBtn).toBeInTheDocument();

    // Tree is visible before collapse
    expect(screen.getByRole('tree')).toBeInTheDocument();

    fireEvent.click(collapseBtn);

    // Sidebar content is gone; only the expand button remains
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Filter files')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('restores expanded sidebar on second click', () => {
    renderLayout();

    const collapseBtn = screen.getByRole('button', { name: 'Collapse sidebar' });
    fireEvent.click(collapseBtn);
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();

    const expandBtn = screen.getByRole('button', { name: 'Expand sidebar' });
    fireEvent.click(expandBtn);

    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('persists collapsed state in localStorage', () => {
    renderLayout();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('sidebarCollapsed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('sidebarCollapsed')).toBe('false');
  });

  it('initialises as collapsed when localStorage says so', () => {
    localStorage.setItem('sidebarCollapsed', 'true');
    renderLayout();

    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Folder expand / collapse
  // -------------------------------------------------------------------------

  it('collapses a folder and hides its children when clicked', () => {
    renderLayout();

    // All children visible initially
    expect(screen.getByRole('treeitem', { name: 'nested' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'intro.md' })).toBeInTheDocument();

    // Click docs to collapse it
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs' }));

    expect(screen.queryByRole('treeitem', { name: 'nested' })).not.toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'intro.md' })).not.toBeInTheDocument();
  });

  it('expands a collapsed folder and shows children on second click', () => {
    renderLayout();

    const docsRow = screen.getByRole('treeitem', { name: 'docs' });
    fireEvent.click(docsRow); // collapse
    expect(screen.queryByRole('treeitem', { name: 'intro.md' })).not.toBeInTheDocument();

    fireEvent.click(docsRow); // expand
    expect(screen.getByRole('treeitem', { name: 'intro.md' })).toBeInTheDocument();
  });

  it('sets aria-expanded false on collapsed folder and true when expanded', () => {
    renderLayout();

    const docsRow = screen.getByRole('treeitem', { name: 'docs' });
    // Initially expanded
    expect(docsRow).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(docsRow);
    expect(docsRow).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(docsRow);
    expect(docsRow).toHaveAttribute('aria-expanded', 'true');
  });

  it('persists collapsed folders in localStorage', () => {
    renderLayout();

    fireEvent.click(screen.getByRole('treeitem', { name: 'docs' }));

    const stored = JSON.parse(localStorage.getItem('collapsedFolders') ?? '[]') as string[];
    expect(stored).toContain('docs');
  });
});
