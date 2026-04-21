import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import * as filesApi from '../api/files';

vi.mock('../api/files', async () => {
  const actual = await vi.importActual<typeof import('../api/files')>('../api/files');

  return {
    ...actual,
    fetchTree: vi.fn(),
    fetchFile: vi.fn(),
  };
});

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the tree, then renders it and fetches file content when a file is selected', async () => {
    vi.mocked(filesApi.fetchTree).mockResolvedValue([
      {
        name: 'README.md',
        path: 'README.md',
        isDirectory: false,
      },
    ]);

    vi.mocked(filesApi.fetchFile).mockResolvedValue({
      path: 'README.md',
      content: '# Loaded from API',
      encoding: 'utf-8',
      lastModified: '2026-04-21T00:00:00.000Z',
      etag: 'readme-v1',
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading files...')).toBeInTheDocument();

    expect(await screen.findByRole('tree', { name: 'Repository file tree' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /README.md/ })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('Loading files...')).not.toBeInTheDocument();
      expect(filesApi.fetchTree).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('link', { name: /README.md/ }));

    await waitFor(() => {
      expect(filesApi.fetchFile).toHaveBeenCalledWith('README.md');
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Loaded from API' })).toBeInTheDocument();
  });
});
