import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, Backlink, BlockAnchor } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface BlockResponse {
  path: string;
  blockId: string;
  startLine: number;
  endLine: number;
  text: string;
  context: string;
  etag: string;
  lastModified: string;
  id?: string;
}

interface FileLike {
  path: string;
  content: string;
  etag: string;
  lastModified: string;
  id?: string;
  dryRun?: boolean;
}

interface AnchorsResponse {
  path: string;
  id?: string;
  etag: string;
  lastModified: string;
  anchors: BlockAnchor[];
}

/**
 * Integration tests for the structured-knowledge surface:
 * - `GET /api/block` (precise block read with surrounding context)
 * - `GET /api/block-anchors` (list anchors in a note)
 * - `PATCH /api/file` with `replace_block` and `ensure_id` ops
 * - `id=` resolution on `/api/file` reads
 * - typed `[[Target|rel:...]]` backlinks surface the relation
 */
describe('structured knowledge surface', () => {
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
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'structured-root-'));
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

  it('reads a block by anchor with surrounding context', async () => {
    const note = [
      '# Doc',
      '',
      'Some intro paragraph.',
      '',
      'A claim worth citing. ^claim-1',
      '',
      'Closing note.',
    ].join('\n');
    await api('POST', '/api/file', { body: { path: 'doc.md', content: note } });

    const block = await api<BlockResponse>('GET', '/api/block?path=doc.md&block=claim-1');
    expect(block.status).toBe(200);
    expect(block.body.data?.text).toBe('A claim worth citing.');
    expect(block.body.data?.startLine).toBe(5);
    expect(block.body.data?.endLine).toBe(5);
    expect(block.body.data?.context).toContain('Some intro paragraph.');
    expect(block.body.data?.context).toContain('Closing note.');
  });

  it('returns 404 when the block id is missing', async () => {
    await api('POST', '/api/file', { body: { path: 'doc.md', content: 'no anchors here\n' } });
    const missing = await api('GET', '/api/block?path=doc.md&block=ghost');
    expect(missing.status).toBe(404);
  });

  it('lists every anchor in a note', async () => {
    const note = [
      '# Doc',
      '',
      'Para. ^p1',
      '',
      '- a ^t1',
      '- b ^t2',
      '',
      '## Heading ^h1',
      'tail',
    ].join('\n');
    await api('POST', '/api/file', { body: { path: 'doc.md', content: note } });

    const result = await api<AnchorsResponse>('GET', '/api/block-anchors?path=doc.md');
    expect(result.status).toBe(200);
    expect(result.body.data?.anchors.map((a) => a.id)).toEqual(['p1', 't1', 't2', 'h1']);
  });

  it('replaces a block via PATCH, audits the change, and keeps siblings intact', async () => {
    const initial = ['# Doc', '', 'First. ^claim-1', '', 'Second untouched.'].join('\n');
    await api('POST', '/api/file', { body: { path: 'doc.md', content: initial } });

    const patched = await api<FileLike>('PATCH', '/api/file', {
      body: {
        path: 'doc.md',
        op: { type: 'replace_block', blockId: 'claim-1', body: 'Revised claim.' },
      },
      actor: 'agent:test',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data?.content).toBe(
      ['# Doc', '', 'Revised claim. ^claim-1', '', 'Second untouched.'].join('\n'),
    );

    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=doc.md');
    expect(audit.body.data?.[0]).toMatchObject({ actor: 'agent:test', action: 'update' });
  });

  it('returns 404 when replace_block targets a missing anchor', async () => {
    await api('POST', '/api/file', { body: { path: 'doc.md', content: '# Doc\n' } });
    const missing = await api('PATCH', '/api/file', {
      body: {
        path: 'doc.md',
        op: { type: 'replace_block', blockId: 'missing', body: 'x' },
      },
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('not_found');
  });

  it('rejects a stale replace_block when etag does not match', async () => {
    const initial = 'Claim. ^c\n';
    const created = await api<FileLike>('POST', '/api/file', {
      body: { path: 'doc.md', content: initial },
    });
    await api('PUT', '/api/file', { body: { path: 'doc.md', content: 'Claim updated. ^c\n' } });

    const stale = await api('PATCH', '/api/file', {
      body: {
        path: 'doc.md',
        op: { type: 'replace_block', blockId: 'c', body: 'New' },
        etag: created.body.data?.etag,
      },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('stale_write');
  });

  it('previews replace_block under dryRun without writing or auditing', async () => {
    const initial = 'Claim. ^c\n';
    await api('POST', '/api/file', { body: { path: 'doc.md', content: initial } });

    const dry = await api<FileLike>('PATCH', '/api/file', {
      body: {
        path: 'doc.md',
        op: { type: 'replace_block', blockId: 'c', body: 'New text.' },
        dryRun: true,
      },
      actor: 'agent:test',
    });
    expect(dry.status).toBe(200);
    expect(dry.body.data?.dryRun).toBe(true);
    expect(dry.body.data?.content).toBe('New text. ^c\n');

    const current = await api<{ content: string }>('GET', '/api/file?path=doc.md');
    expect(current.body.data?.content).toBe(initial);

    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=doc.md');
    expect(audit.body.data?.map((entry) => entry.action)).toEqual(['create']);
  });

  it('ensure_id adds a stable id and is idempotent', async () => {
    const initial = '# Doc\nbody\n';
    await api('POST', '/api/file', { body: { path: 'doc.md', content: initial } });

    const first = await api<FileLike>('PATCH', '/api/file', {
      body: { path: 'doc.md', op: { type: 'ensure_id' } },
      actor: 'agent:test',
    });
    expect(first.status).toBe(200);
    expect(first.body.data?.id).toBeTruthy();
    expect(first.body.data?.content).toMatch(/^---\nid: [0-9a-f-]+\n---\n/);
    const assignedId = first.body.data!.id!;

    // Audit recorded the change.
    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=doc.md');
    expect(audit.body.data?.[0]).toMatchObject({ actor: 'agent:test', action: 'update' });

    // Second call is a no-op: same id, no new audit entry.
    const second = await api<FileLike>('PATCH', '/api/file', {
      body: { path: 'doc.md', op: { type: 'ensure_id' } },
      actor: 'agent:test',
    });
    expect(second.status).toBe(200);
    expect(second.body.data?.id).toBe(assignedId);

    const audit2 = await api<AuditEntry[]>('GET', '/api/audit?path=doc.md');
    expect(audit2.body.data?.length).toBe(2); // create + first update only
  });

  it('exposes the id on file responses and resolves reads by id', async () => {
    const initial = '---\nid: my-stable-id\n---\nbody\n';
    await api('POST', '/api/file', { body: { path: 'doc.md', content: initial } });

    const byPath = await api<FileLike>('GET', '/api/file?path=doc.md');
    expect(byPath.body.data?.id).toBe('my-stable-id');

    const byId = await api<FileLike>('GET', '/api/file?id=my-stable-id');
    expect(byId.status).toBe(200);
    expect(byId.body.data?.path).toBe('doc.md');
  });

  it('surfaces the `rel:` typed relation on backlinks', async () => {
    await api('POST', '/api/file', { body: { path: 'target.md', content: '# Target' } });
    await api('POST', '/api/file', {
      body: { path: 'source.md', content: 'See [[Target|rel:supports]]' },
    });

    const backlinks = await api<Backlink[]>('GET', '/api/backlinks?path=target.md');
    expect(backlinks.status).toBe(200);
    expect(backlinks.body.data).toHaveLength(1);
    expect(backlinks.body.data?.[0]).toMatchObject({
      path: 'source.md',
      type: 'supports',
    });
  });

  it('omits `type` from backlinks when the link is a plain alias', async () => {
    await api('POST', '/api/file', { body: { path: 'target.md', content: '# Target' } });
    await api('POST', '/api/file', {
      body: { path: 'source.md', content: 'See [[Target|Just an alias]]' },
    });

    const backlinks = await api<Backlink[]>('GET', '/api/backlinks?path=target.md');
    expect(backlinks.body.data?.[0]?.type).toBeUndefined();
  });
});
