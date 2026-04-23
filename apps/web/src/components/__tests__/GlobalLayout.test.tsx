import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GlobalLayout } from '../GlobalLayout';

describe('GlobalLayout', () => {
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
    return render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GlobalLayout
          tree={tree}
          onSelectFile={vi.fn()}
          onCreateFile={vi.fn(async () => {})}
          onCreateFolder={vi.fn(async () => {})}
          onRenamePath={vi.fn(async () => {})}
          onDeletePath={vi.fn(async () => {})}
          onSave={vi.fn(async () => {})}
        >
          <div>Editor Panel</div>
        </GlobalLayout>
      </MemoryRouter>,
    );
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

  it('shows an info toast for drops into the same folder', () => {
    renderLayout();

    const introRow = screen.getAllByRole('treeitem', { name: 'intro.md' })[0];
    fireEvent.drop(introRow, {
      dataTransfer: {
        getData: () => 'docs/nested/intro.md',
      },
    });

    expect(screen.getByText('Item is already in that folder.')).toBeInTheDocument();
  });

  it('shows an error toast when moving a folder into itself', () => {
    renderLayout();

    const nestedRow = screen.getAllByRole('treeitem', { name: 'nested' })[0];
    fireEvent.drop(nestedRow, {
      dataTransfer: {
        getData: () => 'docs',
      },
    });

    expect(screen.getByText('Cannot move a folder into itself.')).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem', { name: 'docs' })[0]).toBeInTheDocument();
  });
});
