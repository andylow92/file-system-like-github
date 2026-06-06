import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditProposal, MaintenanceFinding } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface ScanResult {
  findings: MaintenanceFinding[];
  proposalsFiled: EditProposal[];
}

describe('maintenance — scan → review proposals', () => {
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

  beforeEach(async () => {
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'maint-root-'));
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

  it('GET /api/maintenance is a dry preview — it finds problems but files nothing', async () => {
    await seed('index.md', '# Index\nSee [[guide]] and [[ghost]] for more.');
    await seed('guide.md', '# Guide\nBack to [[index]].');

    const preview = await api<{ findings: MaintenanceFinding[] }>('GET', '/api/maintenance');
    expect(preview.status).toBe(200);
    const broken = preview.body.data!.findings.filter((f) => f.kind === 'broken_link');
    expect(broken).toHaveLength(1);
    expect(broken[0].suggestion!.path).toBe('ghost.md');

    // The preview never files a proposal.
    const pending = await api<EditProposal[]>('GET', '/api/proposals?status=pending');
    expect(pending.body.data).toEqual([]);
  });

  it('POST /api/maintenance/scan files a proposal per actionable finding as agent:maintenance', async () => {
    await seed('index.md', '# Index\nSee [[guide]] and [[ghost]] for more.');
    await seed('guide.md', '# Guide\nBack to [[index]].');

    const scan = await api<ScanResult>('POST', '/api/maintenance/scan');
    expect(scan.status).toBe(200);

    const { findings, proposalsFiled } = scan.body.data!;
    expect(findings.some((f) => f.kind === 'broken_link')).toBe(true);
    expect(proposalsFiled).toHaveLength(1);

    const filed = proposalsFiled[0];
    expect(filed.actor).toBe('agent:maintenance');
    expect(filed.action).toBe('create');
    expect(filed.path).toBe('ghost.md');
    expect(filed.status).toBe('pending');
    expect(filed.content).toContain('# ghost');

    // It is visible in the human Review queue.
    const pending = await api<EditProposal[]>('GET', '/api/proposals?status=pending');
    expect(pending.body.data!.map((p) => p.id)).toContain(filed.id);
  });

  it('is idempotent — re-running never re-files an already-open proposal', async () => {
    await seed('index.md', '# Index\nSee [[guide]] and [[ghost]] for more.');
    await seed('guide.md', '# Guide\nBack to [[index]].');

    const first = await api<ScanResult>('POST', '/api/maintenance/scan');
    expect(first.body.data!.proposalsFiled).toHaveLength(1);

    const second = await api<ScanResult>('POST', '/api/maintenance/scan');
    // The same broken link is still reported, but no new proposal is filed.
    expect(second.body.data!.findings.some((f) => f.kind === 'broken_link')).toBe(true);
    expect(second.body.data!.proposalsFiled).toEqual([]);

    const pending = await api<EditProposal[]>('GET', '/api/proposals?status=pending');
    expect(pending.body.data).toHaveLength(1);
  });

  it('files a conservative cross-link update for a near-duplicate pair', async () => {
    const body = '# Topic\nThe nightly dream cycle dedupes notes and repairs broken links.';
    await seed('dupA.md', body);
    await seed('dupB.md', body);

    const scan = await api<ScanResult>('POST', '/api/maintenance/scan');
    const { findings, proposalsFiled } = scan.body.data!;

    const duplicate = findings.find((f) => f.kind === 'duplicate');
    expect(duplicate).toBeDefined();
    expect(duplicate!.paths).toEqual(['dupA.md', 'dupB.md']);

    // Orphans are report-only (no suggestion), so only the duplicate is filed.
    expect(proposalsFiled).toHaveLength(1);
    expect(proposalsFiled[0].action).toBe('update');
    expect(proposalsFiled[0].path).toBe('dupA.md');
    expect(proposalsFiled[0].content).toContain('> See also [[dupB]]');
  });

  it('stamps a duplicate update with baseEtag so a stale approval is rejected', async () => {
    const body = '# Topic\nThe nightly dream cycle dedupes notes and repairs broken links.';
    await seed('dupA.md', body);
    await seed('dupB.md', body);

    const scan = await api<ScanResult>('POST', '/api/maintenance/scan');
    const update = scan.body.data!.proposalsFiled.find((p) => p.action === 'update');
    expect(update).toBeDefined();
    // The update carries the target's current etag — the optimistic-concurrency guard.
    expect(update!.baseEtag).toBeTruthy();

    // A human edits dupA after the scan was filed...
    const before = await api<{ etag: string }>('GET', '/api/file?path=dupA.md');
    await api('PUT', '/api/file', {
      body: { path: 'dupA.md', content: `${body}\n\nHuman edit.`, etag: before.body.data!.etag },
    });

    // ...so approving the now-stale maintenance proposal 409s instead of clobbering it.
    const resolve = await api('POST', '/api/proposals/resolve', {
      body: { id: update!.id, decision: 'approve' },
    });
    expect(resolve.status).toBe(409);

    // And the human's edit survived.
    const after = await api<{ content: string }>('GET', '/api/file?path=dupA.md');
    expect(after.body.data!.content).toContain('Human edit.');
  });
});
