import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, FileNode, SearchMatch, SemanticHit } from '@repo/shared';

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
});
