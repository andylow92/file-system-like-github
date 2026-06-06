import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditProposal } from '@repo/shared';
import { MaintenancePanel } from '../MaintenancePanel';
import { runMaintenance } from '../../api/files';

// Mock only the network call; keep the real `getErrorMessage`.
vi.mock('../../api/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/files')>();
  return { ...actual, runMaintenance: vi.fn() };
});

const proposal = (overrides: Partial<EditProposal>): EditProposal => ({
  id: 'p1',
  ts: '2026-06-06T00:00:00.000Z',
  actor: 'agent:maintenance',
  action: 'create',
  path: 'ghost.md',
  status: 'pending',
  ...overrides,
});

describe('MaintenancePanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('runs a scan, lists findings grouped by kind, and reports filed proposals', async () => {
    vi.mocked(runMaintenance).mockResolvedValue({
      findings: [
        {
          kind: 'broken_link',
          paths: ['index.md'],
          detail: '1 note(s) link to "ghost", which resolves to no note.',
          suggestion: { action: 'create', path: 'ghost.md', content: '# ghost', note: 'stub' },
        },
        {
          kind: 'orphan',
          paths: ['lonely.md'],
          detail: '"lonely" has no inbound or outbound [[wikilinks]] (isolated note).',
        },
      ],
      proposalsFiled: [proposal({})],
    });
    const onFiled = vi.fn();

    render(<MaintenancePanel onFiled={onFiled} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run scan' }));

    expect(await screen.findByText(/Broken links \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Orphan notes \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 new proposal filed/)).toBeInTheDocument();
    await waitFor(() => expect(onFiled).toHaveBeenCalledTimes(1));
  });

  it('reports a healthy vault and does not notify when nothing is filed', async () => {
    vi.mocked(runMaintenance).mockResolvedValue({ findings: [], proposalsFiled: [] });
    const onFiled = vi.fn();

    render(<MaintenancePanel onFiled={onFiled} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run scan' }));

    expect(await screen.findByText(/the vault is healthy/)).toBeInTheDocument();
    expect(onFiled).not.toHaveBeenCalled();
  });
});
