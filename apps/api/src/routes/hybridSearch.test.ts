import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HybridHit } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

describe('hybrid search (RRF fusion of lexical + semantic)', () => {
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

  beforeEach(async () => {
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'hybrid-root-'));
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

  it('requires a query (422 without q)', async () => {
    const missing = await api('GET', '/api/hybrid-search');
    expect(missing.status).toBe(422);
  });

  it('fuses an exact keyword hit and a relevance-only hit into one ranked list', async () => {
    // Contains the literal keyword "mitochondria" — a lexical hit.
    await api('POST', '/api/file', {
      body: {
        path: 'cell.md',
        content: '# Cell biology\nThe mitochondria is the powerhouse of the cell.',
      },
    });
    // No literal keyword, but conceptually about the same thing — a semantic hit.
    await api('POST', '/api/file', {
      body: {
        path: 'energy.md',
        content: '# Energy\nOrganelles generate ATP that fuels cellular respiration.',
      },
    });

    const result = await api<HybridHit[]>('GET', '/api/hybrid-search?q=mitochondria');
    expect(result.status).toBe(200);

    const hits = result.body.data!;
    const paths = hits.map((hit) => hit.path);
    // The exact keyword note is found by the lexical engine.
    expect(paths).toContain('cell.md');

    const cell = hits.find((hit) => hit.path === 'cell.md')!;
    expect(cell.sources).toContain('text');
    // The lexical line is preferred as the legible snippet.
    expect(cell.snippet.toLowerCase()).toContain('mitochondria');
    expect(cell.line).toBeGreaterThan(0);
  });

  it('labels semantic-only hits and carries their tags', async () => {
    await api('POST', '/api/file', {
      body: {
        path: 'felines.md',
        content: '---\ntags: [animals]\n---\n# Felines\nCats are independent, aloof companions.',
      },
    });

    const result = await api<HybridHit[]>('GET', '/api/hybrid-search?q=independent feline pet');
    const felines = result.body.data!.find((hit) => hit.path === 'felines.md');
    expect(felines).toBeDefined();
    expect(felines!.sources).toContain('semantic');
    // Tags come from the note even when only the semantic engine matched.
    expect(felines!.tags).toContain('animals');
  });

  it('honors the limit and reflects new notes without a restart', async () => {
    await api('POST', '/api/file', {
      body: { path: 'a.md', content: '# A\nalpha beta gamma' },
    });

    // Warm the cached index.
    await api<HybridHit[]>('GET', '/api/hybrid-search?q=alpha');

    // A brand-new note must surface (create invalidates the cache).
    await api('POST', '/api/file', {
      body: { path: 'b.md', content: '# B\nalpha delta epsilon' },
    });

    const limited = await api<HybridHit[]>('GET', '/api/hybrid-search?q=alpha&limit=1');
    expect(limited.body.data!.length).toBe(1);

    const all = await api<HybridHit[]>('GET', '/api/hybrid-search?q=alpha');
    expect(all.body.data!.map((hit) => hit.path)).toContain('b.md');
  });
});
