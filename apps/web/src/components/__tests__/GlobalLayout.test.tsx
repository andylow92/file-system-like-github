import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GlobalLayout } from '../GlobalLayout';

describe('GlobalLayout', () => {
  it('renders each tree row as a single draggable treeitem', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GlobalLayout
          tree={[
            {
              name: 'docs',
              path: 'docs',
              isDirectory: true,
              children: [{ name: 'intro.md', path: 'docs/intro.md', isDirectory: false }],
            },
          ]}
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

    const folderRow = screen.getByRole('treeitem', { name: 'docs' });
    expect(folderRow).toHaveAttribute('draggable', 'true');
    expect(folderRow).toHaveAttribute('data-kind', 'directory');

    const fileRow = screen.getByRole('treeitem', { name: 'intro.md' });
    expect(fileRow).toHaveAttribute('draggable', 'true');
    expect(fileRow).toHaveAttribute('data-kind', 'file');
    expect(fileRow).toHaveAttribute('data-path', 'docs/intro.md');
  });
});
