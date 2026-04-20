import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GlobalLayout } from '../GlobalLayout';

describe('GlobalLayout', () => {
  it('renders directory tree and file links for interactions', () => {
    render(
      <MemoryRouter>
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

    expect(screen.getByText('docs/')).toBeInTheDocument();

    const fileLink = screen.getByRole('link', { name: 'intro.md' });
    expect(fileLink).toHaveAttribute('href', '/file/docs%2Fintro.md');
  });
});
