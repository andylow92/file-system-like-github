import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface PatchFileResponse {
  path: string;
  content: string;
  encoding: 'utf-8';
  lastModified: string;
  etag: string;
  dryRun: boolean;
}

/**
 * Integration tests for `PATCH /api/file` — the granular agent-write surface.
 * They exercise append/prepend/replace_section, etag-stale 409s, idempotency
 * key replay, dry-run (no write, no audit), and `X-Actor` attribution.
 */
describe('PATCH /api/file', () => {
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
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'patch-file-root-'));
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

  it('appends to a note and records the change as the requesting actor', async () => {
    await api('POST', '/api/file', { body: { path: 'todo.md', content: '# Todo\n' } });

    const patched = await api<PatchFileResponse>('PATCH', '/api/file', {
      body: { path: 'todo.md', op: { type: 'append', text: '- buy milk' } },
      actor: 'agent:test',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data?.content).toBe('# Todo\n- buy milk');
    expect(patched.body.data?.dryRun).toBe(false);

    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=todo.md');
    // Newest first: PATCH update, then initial POST create.
    expect(audit.body.data?.[0]).toMatchObject({ actor: 'agent:test', action: 'update' });
    expect(audit.body.data?.[0]?.etag).toBe(patched.body.data?.etag);
  });

  it('prepends after frontmatter and reports the new content', async () => {
    const initial = '---\ntitle: Notes\n---\n\nbody\n';
    await api('POST', '/api/file', { body: { path: 'note.md', content: initial } });

    const patched = await api<PatchFileResponse>('PATCH', '/api/file', {
      body: { path: 'note.md', op: { type: 'prepend', text: '> WIP' } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data?.content).toBe('---\ntitle: Notes\n---\n> WIP\n\nbody\n');
  });

  it('replaces the body under the requested heading', async () => {
    const initial = '# Doc\n\n## Tasks\n- old\n\n## Next\nkeep\n';
    await api('POST', '/api/file', { body: { path: 'doc.md', content: initial } });

    const patched = await api<PatchFileResponse>('PATCH', '/api/file', {
      body: {
        path: 'doc.md',
        op: { type: 'replace_section', heading: '## Tasks', body: '- new' },
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data?.content).toBe('# Doc\n\n## Tasks\n- new\n## Next\nkeep\n');
  });

  it('returns 404 when replace_section cannot find the heading', async () => {
    await api('POST', '/api/file', { body: { path: 'doc.md', content: '# Doc\n' } });
    const missing = await api('PATCH', '/api/file', {
      body: { path: 'doc.md', op: { type: 'replace_section', heading: '## Nope', body: 'x' } },
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe('not_found');
  });

  it('rejects a stale write when etag does not match', async () => {
    const created = await api<PatchFileResponse>('POST', '/api/file', {
      body: { path: 'a.md', content: 'v1\n' },
    });
    // Mutate the file out-of-band so the original etag is stale.
    await api('PUT', '/api/file', { body: { path: 'a.md', content: 'v2\n' } });

    const stale = await api('PATCH', '/api/file', {
      body: {
        path: 'a.md',
        op: { type: 'append', text: 'late' },
        etag: created.body.data?.etag,
      },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('stale_write');

    // The file body must not have been mutated by the rejected patch.
    const current = await api<{ content: string }>('GET', '/api/file?path=a.md');
    expect(current.body.data?.content).toBe('v2\n');
  });

  it('does not write when dryRun is true, but returns the previewed content', async () => {
    await api('POST', '/api/file', { body: { path: 'todo.md', content: '# Todo\n' } });

    const dry = await api<PatchFileResponse>('PATCH', '/api/file', {
      body: {
        path: 'todo.md',
        op: { type: 'append', text: '- buy milk' },
        dryRun: true,
      },
      actor: 'agent:test',
    });
    expect(dry.status).toBe(200);
    expect(dry.body.data?.dryRun).toBe(true);
    expect(dry.body.data?.content).toBe('# Todo\n- buy milk');

    // On disk the file is unchanged, and no audit entry was recorded.
    const current = await api<{ content: string }>('GET', '/api/file?path=todo.md');
    expect(current.body.data?.content).toBe('# Todo\n');

    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=todo.md');
    // Only the initial `create` from the POST above — no `update` from the dry-run.
    expect(audit.body.data?.map((entry) => entry.action)).toEqual(['create']);
  });

  it('replays an idempotency-keyed patch without writing twice or auditing twice', async () => {
    await api('POST', '/api/file', { body: { path: 'todo.md', content: 'a\n' } });

    const first = await api<PatchFileResponse>('PATCH', '/api/file', {
      body: {
        path: 'todo.md',
        op: { type: 'append', text: 'b' },
        idempotencyKey: 'k-1',
      },
      actor: 'agent:test',
    });
    expect(first.status).toBe(200);
    expect(first.body.data?.content).toBe('a\nb');

    const replay = await api<PatchFileResponse>('PATCH', '/api/file', {
      body: {
        path: 'todo.md',
        op: { type: 'append', text: 'b' },
        idempotencyKey: 'k-1',
      },
      actor: 'agent:test',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);

    // The body must not have grown on the replay, and audit must contain
    // exactly one `update` (from the first call), plus the original `create`.
    const current = await api<{ content: string }>('GET', '/api/file?path=todo.md');
    expect(current.body.data?.content).toBe('a\nb');

    const audit = await api<AuditEntry[]>('GET', '/api/audit?path=todo.md');
    const actions = audit.body.data?.map((entry) => entry.action) ?? [];
    expect(actions).toEqual(['update', 'create']);
  });

  it('validates the op shape', async () => {
    await api('POST', '/api/file', { body: { path: 'a.md', content: 'x' } });

    const missingOp = await api('PATCH', '/api/file', { body: { path: 'a.md' } });
    expect(missingOp.status).toBe(422);
    expect(missingOp.body.error?.code).toBe('validation_error');

    const badType = await api('PATCH', '/api/file', {
      body: { path: 'a.md', op: { type: 'overwrite', text: 'x' } },
    });
    expect(badType.status).toBe(422);
    expect(badType.body.error?.message).toMatch(/op\.type/);
  });
});
