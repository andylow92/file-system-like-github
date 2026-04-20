import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';

describe('App', () => {
  it('renders the initial file tree without runtime errors', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'docs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'README.md' })).toBeInTheDocument();
  });
});
