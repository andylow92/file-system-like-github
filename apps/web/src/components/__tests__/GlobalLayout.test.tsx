import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
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
