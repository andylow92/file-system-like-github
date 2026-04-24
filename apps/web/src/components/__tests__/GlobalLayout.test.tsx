import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalLayout } from '../GlobalLayout';

describe('GlobalLayout', () => {
  afterEach(() => {
    cleanup();
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

  it('renders each tree row as a single draggable treeitem', () => {
    renderLayout();

    const folderRow = screen.getByRole('treeitem', { name: 'docs' });
    expect(folderRow).toHaveAttribute('draggable', 'true');
    expect(folderRow).toHaveAttribute('data-kind', 'directory');

    const fileRow = screen.getByRole('treeitem', { name: 'intro.md' });
    expect(fileRow).toHaveAttribute('draggable', 'true');
    expect(fileRow).toHaveAttribute('data-kind', 'file');
    expect(fileRow).toHaveAttribute('data-path', 'docs/nested/intro.md');
  });

  it('shows an error toast when drop source path is missing', () => {
    renderLayout();

    const docsRow = screen.getAllByRole('treeitem', { name: 'docs' })[0];
    fireEvent.drop(docsRow, {
      dataTransfer: {
        getData: () => '',
      },
    });

    expect(screen.getByText('Could not determine dragged item. Try again.')).toBeInTheDocument();
  });

  it('shows an info toast and does not rename when dropping on a file row', () => {
    const { onRenamePath } = renderLayout();

    const introRow = screen.getAllByRole('treeitem', { name: 'intro.md' })[0];
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

    const docsRow = screen.getAllByRole('treeitem', { name: 'docs' })[0];
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

    const nestedRow = screen.getAllByRole('treeitem', { name: 'nested' })[0];
    fireEvent.drop(nestedRow, {
      dataTransfer: {
        getData: () => 'docs',
      },
    });

    expect(screen.getAllByText('Cannot move a folder into itself.').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('treeitem', { name: 'docs' })[0]).toBeInTheDocument();
  });
});
