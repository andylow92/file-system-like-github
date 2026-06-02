import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, EditProposal, FileNode, SearchMatch, SemanticHit } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

describe('search, audit, and hidden-file handling', () => {
  let contentRoot = '';
  let baseUrl = '';
  let server: http.Server | undefined;

  async function api<T>(
    method: string,
    pathname: string,
    options: { body?: unknown; actor?: string } = {},
  ): Promise<{ status: number; body: ApiResponse<T> }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.actor) {
      headers['X-Actor'] = options.actor;
    }
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: (await response.json()) as ApiResponse<T> };
  }

  beforeEach(async () => {
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'search-audit-root-'));
    process.env.CONTENT_ROOT = contentRoot;
    vi.resetModules();

    const { createServer } = await import('../server.js');
    const created = createServer();
    server = created;
    await new Promise<void>((resolve) => created.listen(0, () => resolve()));

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

  it('records provenance with the actor and excludes the audit store from the tree', async () => {
    const created = await api('POST', '/api/file', {
      body: { path: 'notes/idea.md', content: '# Idea\n\nbody' },
      actor: 'agent:test',
    });
    expect(created.status).toBe(201);

    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=notes/idea.md');
    expect(audit.status).toBe(200);
    expect(audit.body.data).toHaveLength(1);
    expect(audit.body.data?.[0]).toMatchObject({ actor: 'agent:test', action: 'create' });

    // The hidden .fsbrain audit directory must not appear in the tree.
    const tree = await api<FileNode[]>('GET', '/api/tree');
    const names = (tree.body.data ?? []).map((node) => node.name);
    expect(names).not.toContain('.fsbrain');
    expect(names).toContain('notes');
  });

  it('defaults the actor to human when no header is sent', async () => {
    await api('POST', '/api/file', { body: { path: 'human.md', content: 'hi' } });
    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=human.md');
    expect(audit.body.data?.[0]?.actor).toBe('human');
  });

  it('finds notes by full-text query and by tag', async () => {
    await api('POST', '/api/file', {
      body: { path: 'a.md', content: '---\ntags: [project]\n---\nThe quick brown fox' },
    });
    await api('POST', '/api/file', { body: { path: 'b.md', content: 'nothing relevant here' } });

    const byText = await api<SearchMatch[]>('GET', '/api/search?q=quick');
    expect(byText.status).toBe(200);
    expect(byText.body.data?.map((match) => match.path)).toEqual(['a.md']);
    expect(byText.body.data?.[0]?.snippet).toContain('quick');

    const byTag = await api<SearchMatch[]>('GET', '/api/search?tag=project');
    expect(byTag.body.data?.map((match) => match.path)).toEqual(['a.md']);

    const missingParams = await api('GET', '/api/search');
    expect(missingParams.status).toBe(422);
  });

  it('ranks notes by relevance via semantic search', async () => {
    await api('POST', '/api/file', {
      body: { path: 'cats.md', content: '# Cats\nFelines purr and chase mice; great pets.' },
    });
    await api('POST', '/api/file', {
      body: { path: 'budget.md', content: '# Budget\nRevenue, expenses, and cash flow.' },
    });

    const result = await api<SemanticHit[]>('GET', '/api/semantic-search?q=feline pet that purrs');
    expect(result.status).toBe(200);
    expect(result.body.data?.[0]?.path).toBe('cats.md');
    expect(result.body.data?.[0]?.score).toBeGreaterThan(0);

    const missing = await api('GET', '/api/semantic-search');
    expect(missing.status).toBe(422);
  });

  it('queues an agent proposal and applies it on approval, audited as the agent', async () => {
    const proposed = await api<EditProposal>('POST', '/api/proposals', {
      body: { action: 'create', path: 'from-agent.md', content: '# Agent note', note: 'draft' },
      actor: 'agent:test',
    });
    expect(proposed.status).toBe(201);
    const id = proposed.body.data!.id;

    // Pending, and the file does not exist yet.
    const pending = await api<EditProposal[]>('GET', '/api/proposals?status=pending');
    expect(pending.body.data?.map((p) => p.id)).toContain(id);
    expect((await api('GET', '/api/file?path=from-agent.md')).status).toBe(404);

    // Human approves (actor defaults to human).
    const approved = await api<EditProposal>('POST', '/api/proposals/resolve', {
      body: { id, decision: 'approve' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: 'approved', resolvedBy: 'human' });

    // File now exists; the audit attributes the change to the proposing agent.
    expect((await api('GET', '/api/file?path=from-agent.md')).status).toBe(200);
    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=from-agent.md');
    expect(audit.body.data?.[0]).toMatchObject({ actor: 'agent:test', action: 'create' });

    // Re-resolving a settled proposal conflicts.
    const again = await api('POST', '/api/proposals/resolve', {
      body: { id, decision: 'approve' },
    });
    expect(again.status).toBe(409);
  });

  it('rejects a proposal without touching the vault', async () => {
    const proposed = await api<EditProposal>('POST', '/api/proposals', {
      body: { action: 'create', path: 'nope.md', content: 'x' },
      actor: 'agent:test',
    });
    const id = proposed.body.data!.id;

    const rejected = await api<EditProposal>('POST', '/api/proposals/resolve', {
      body: { id, decision: 'reject' },
    });
    expect(rejected.body.data?.status).toBe('rejected');
    expect((await api('GET', '/api/file?path=nope.md')).status).toBe(404);
  });

  it('forbids an agent actor from resolving a proposal', async () => {
    const proposed = await api<EditProposal>('POST', '/api/proposals', {
      body: { action: 'create', path: 'guarded.md', content: 'x' },
      actor: 'agent:test',
    });
    const id = proposed.body.data!.id;

    const forbidden = await api('POST', '/api/proposals/resolve', {
      body: { id, decision: 'approve' },
      actor: 'agent:test',
    });
    expect(forbidden.status).toBe(403);
    // The proposal stays pending and nothing was written.
    expect((await api('GET', '/api/file?path=guarded.md')).status).toBe(404);
  });

  it('rejects approving a stale delete proposal', async () => {
    await api('POST', '/api/file', { body: { path: 'doomed.md', content: 'v1' } });
    const file = await api<{ etag: string }>('GET', '/api/file?path=doomed.md');
    const baseEtag = file.body.data!.etag;

    const proposed = await api<EditProposal>('POST', '/api/proposals', {
      body: { action: 'delete', path: 'doomed.md', baseEtag },
      actor: 'agent:test',
    });
    const id = proposed.body.data!.id;

    // The file changes after the proposal was made.
    await api('PUT', '/api/file', { body: { path: 'doomed.md', content: 'v2 changed' } });

    const stale = await api('POST', '/api/proposals/resolve', {
      body: { id, decision: 'approve' },
    });
    expect(stale.status).toBe(409);
    expect((await api('GET', '/api/file?path=doomed.md')).status).toBe(200);
  });
});
