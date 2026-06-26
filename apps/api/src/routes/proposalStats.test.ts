import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CategoryStat,
  EditProposal,
  MaintenanceFinding,
  ThresholdRecommendation,
} from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface StatsResult {
  categories: CategoryStat[];
  recommendations: ThresholdRecommendation[];
}

interface ScanResult {
  findings: MaintenanceFinding[];
  proposalsFiled: EditProposal[];
  tuning?: ThresholdRecommendation;
}

describe('proposal stats — review-queue learning', () => {
  let contentRoot = '';
  let baseUrl = '';
  let server: http.Server | undefined;

  async function api<T>(
    method: string,
    pathname: string,
    options: { body?: unknown } = {},
  ): Promise<{ status: number; body: ApiResponse<T> }> {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: (await response.json()) as ApiResponse<T> };
  }

  const seed = (notePath: string, content: string) =>
    api('POST', '/api/file', { body: { path: notePath, content } });

  /** File a proposal and immediately reject it (reject never touches the vault). */
  async function fileAndReject(category: string, notePath: string): Promise<void> {
    const created = await api<EditProposal>('POST', '/api/proposals', {
      body: { action: 'create', path: notePath, content: '# stub\n', category },
    });
    await api('POST', '/api/proposals/resolve', {
      body: { id: created.body.data!.id, decision: 'reject' },
    });
  }

  beforeEach(async () => {
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'pstats-root-'));
    process.env.CONTENT_ROOT = contentRoot;
    vi.resetModules();

    const { createServer } = await import('../server.js');
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, () => resolve()));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine server address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
    await rm(contentRoot, { recursive: true, force: true });
  });

  it('returns empty categories and no recommendations on a fresh vault', async () => {
    const stats = await api<StatsResult>('GET', '/api/proposals/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.data).toEqual({ categories: [], recommendations: [] });
  });

  it('tallies maintenance-filed proposals under a maintenance:<kind> category', async () => {
    await seed('index.md', '# Index\nSee [[ghost]] for more.');
    await api<ScanResult>('POST', '/api/maintenance/scan');

    const stats = await api<StatsResult>('GET', '/api/proposals/stats');
    const broken = stats.body.data!.categories.find(
      (c) => c.category === 'maintenance:broken_link',
    );
    expect(broken).toBeDefined();
    expect(broken!.pending).toBe(1);
    expect(broken!.approvalRate).toBeNull(); // nothing resolved yet
  });

  it('recommends raising the duplicate bar once the human keeps rejecting duplicates', async () => {
    // Ten rejected duplicate cross-links — a clear "stop suggesting these" signal.
    for (let i = 0; i < 10; i += 1) {
      await fileAndReject('maintenance:duplicate', `rej-${i}.md`);
    }

    const stats = await api<StatsResult>('GET', '/api/proposals/stats');
    const dup = stats.body.data!.categories.find((c) => c.category === 'maintenance:duplicate')!;
    expect(dup.rejected).toBe(10);
    expect(dup.approvalRate).toBe(0);

    const rec = stats.body.data!.recommendations.find(
      (r) => r.category === 'maintenance:duplicate',
    );
    expect(rec).toBeDefined();
    expect(rec!.current).toBe(0.85);
    expect(rec!.recommended).toBe(0.88); // raised by one step
  });

  it('the maintenance scan adopts the tuned threshold from review history', async () => {
    for (let i = 0; i < 10; i += 1) {
      await fileAndReject('maintenance:duplicate', `rej-${i}.md`);
    }

    // Two near-identical notes — still duplicates even at the raised threshold.
    const body = '# Topic\nThe nightly dream cycle dedupes notes and repairs broken links.';
    await seed('dupA.md', body);
    await seed('dupB.md', body);

    const scan = await api<ScanResult>('POST', '/api/maintenance/scan');
    expect(scan.body.data!.tuning).toBeDefined();
    expect(scan.body.data!.tuning!.recommended).toBe(0.88);
    // The duplicate is still found and filed (cosine ~1.0 clears the raised bar).
    expect(scan.body.data!.findings.some((f) => f.kind === 'duplicate')).toBe(true);
  });

  it('groups ad-hoc proposals without a category under actor:action', async () => {
    await api<EditProposal>('POST', '/api/proposals', {
      body: { action: 'create', path: 'note.md', content: '# Note\n' },
    });
    const stats = await api<StatsResult>('GET', '/api/proposals/stats');
    // Default actor is a human (no X-Actor header) → `<actor>:create`.
    const adhoc = stats.body.data!.categories.find((c) => c.category.endsWith(':create'));
    expect(adhoc).toBeDefined();
    expect(adhoc!.pending).toBe(1);
  });
});
