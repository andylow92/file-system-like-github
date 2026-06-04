import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextBundle, SearchMatch, SemanticHit } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

describe('context bundles + cached retrieval index', () => {
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
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'context-root-'));
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
    const missing = await api('GET', '/api/context');
    expect(missing.status).toBe(422);
  });

  it('returns the most relevant passages within the token budget', async () => {
    await api('POST', '/api/file', {
      body: {
        path: 'cats.md',
        content: '# Cats\nFelines purr and chase mice; they make great pets.',
      },
    });
    await api('POST', '/api/file', {
      body: { path: 'budget.md', content: '# Budget\nQuarterly revenue, expenses, and cash flow.' },
    });

    const result = await api<ContextBundle>(
      'GET',
      '/api/context?q=feline pet that purrs&budget=200',
    );
    expect(result.status).toBe(200);

    const bundle = result.body.data!;
    expect(bundle.tokenBudget).toBe(200);
    expect(bundle.items.length).toBeGreaterThan(0);
    // The relevant note ranks; items carry full chunk text (not a 200-char snippet).
    expect(bundle.items[0]).toMatchObject({ path: 'cats.md', kind: 'match' });
    expect(bundle.items[0].text).toContain('Felines');
    // The budget is respected.
    expect(bundle.usedTokens).toBeLessThanOrEqual(bundle.tokenBudget);
  });

  it('adds the focus note and its backlinks as neighbor context', async () => {
    await api('POST', '/api/file', {
      body: { path: 'guide.md', content: '# Guide\nHow to care for felines day to day.' },
    });
    await api('POST', '/api/file', {
      body: { path: 'diary.md', content: '# Diary\nToday I read [[guide]] about caring for cats.' },
    });

    const result = await api<ContextBundle>('GET', '/api/context?q=feline care&path=guide.md');
    expect(result.status).toBe(200);

    const bundle = result.body.data!;
    expect(bundle.focusPath).toBe('guide.md');
    // The focus note is present, and its backlink (diary.md) is a neighbor.
    expect(bundle.items.some((item) => item.path === 'guide.md')).toBe(true);
    const neighborPaths = bundle.items
      .filter((item) => item.kind === 'neighbor')
      .map((item) => item.path);
    expect(neighborPaths).toContain('diary.md');
  });

  it('reflects new and updated notes immediately — no stale cache after a write', async () => {
    await api('POST', '/api/file', {
      body: { path: 'cats.md', content: '# Cats\nFelines purr and chase mice.' },
    });

    // First query warms and builds the cached index.
    const first = await api<ContextBundle>('GET', '/api/context?q=feline');
    expect(first.body.data?.items.some((item) => item.path === 'cats.md')).toBe(true);

    // A brand-new note must surface without a restart (create invalidates).
    await api('POST', '/api/file', {
      body: {
        path: 'lions.md',
        content: '# Lions\nLions are large felines that roar on the savanna.',
      },
    });
    const semantic = await api<SemanticHit[]>('GET', '/api/semantic-search?q=feline');
    expect(semantic.body.data?.map((hit) => hit.path)).toContain('lions.md');

    // An update to an existing note must be reflected too (update invalidates).
    await api('PUT', '/api/file', {
      body: { path: 'cats.md', content: '# Cats\nThey are independent and aloof companions.' },
    });
    const search = await api<SearchMatch[]>('GET', '/api/search?q=independent');
    expect(search.body.data?.map((match) => match.path)).toContain('cats.md');

    // And the now-removed term is gone from the cached full-text search.
    const stale = await api<SearchMatch[]>('GET', '/api/search?q=purr');
    expect(stale.body.data?.map((match) => match.path)).not.toContain('cats.md');
  });
});
