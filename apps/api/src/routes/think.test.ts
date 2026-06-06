import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerKit } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

type ThinkResponse = AnswerKit & { answer?: string };

describe('think — cited answer kit + offline gap analysis', () => {
  let contentRoot = '';
  let baseUrl = '';
  let server: http.Server | undefined;
  let savedKey: string | undefined;

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
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'think-root-'));
    process.env.CONTENT_ROOT = contentRoot;
    // Keep the endpoint fully offline regardless of the developer's env.
    savedKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
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
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
    await rm(contentRoot, { recursive: true, force: true });
  });

  it('requires a query (422 without q)', async () => {
    const missing = await api('GET', '/api/think');
    expect(missing.status).toBe(422);
  });

  it('returns numbered citations grounded in the vault, offline (no answer)', async () => {
    await api('POST', '/api/file', {
      body: {
        path: 'cats.md',
        content: '# Cats\nFelines purr and chase mice; they make great pets.',
      },
    });
    await api('POST', '/api/file', {
      body: { path: 'budget.md', content: '# Budget\nQuarterly revenue, expenses, and cash flow.' },
    });

    const result = await api<ThinkResponse>('GET', '/api/think?q=feline pet that purrs');
    expect(result.status).toBe(200);

    const kit = result.body.data!;
    expect(kit.query).toBe('feline pet that purrs');
    expect(kit.citations.length).toBeGreaterThan(0);
    // Citations are 1-based and map onto the passages.
    expect(kit.citations.map((c) => c.n)).toEqual(kit.passages.map((_, i) => i + 1));
    expect(kit.citations[0].path).toBe('cats.md');
    // Coverage is strong for an on-topic query — not flagged as a gap.
    expect(kit.coverage.topScore).toBeGreaterThan(0);
    expect(kit.gaps.weakCoverage).toBe(false);
    expect(kit.gaps.topScore).toBe(kit.coverage.topScore);
    // Offline by default: no synthesized answer without a server-side key.
    expect(kit.answer).toBeUndefined();
  });

  it('reports query terms the vault does not cover', async () => {
    await api('POST', '/api/file', {
      body: { path: 'cats.md', content: '# Cats\nFelines purr and chase mice.' },
    });

    const result = await api<ThinkResponse>('GET', '/api/think?q=feline submarine');
    const kit = result.body.data!;
    // "feline" is grounded; "submarine" is the gap.
    expect(kit.gaps.uncoveredTerms).toContain('submarine');
    expect(kit.gaps.uncoveredTerms).not.toContain('feline');
  });

  it('flags weak coverage and every term uncovered when nothing matches', async () => {
    await api('POST', '/api/file', {
      body: { path: 'cats.md', content: '# Cats\nFelines purr and chase mice.' },
    });

    const result = await api<ThinkResponse>('GET', '/api/think?q=quantum chromodynamics');
    const kit = result.body.data!;
    expect(kit.citations).toEqual([]);
    expect(kit.gaps.weakCoverage).toBe(true);
    expect(kit.gaps.uncoveredTerms).toEqual(['quantum', 'chromodynamics']);
  });

  it('adds the focus note and its backlinks as neighbor citations', async () => {
    await api('POST', '/api/file', {
      body: { path: 'guide.md', content: '# Guide\nHow to care for felines day to day.' },
    });
    await api('POST', '/api/file', {
      body: { path: 'diary.md', content: '# Diary\nToday I read [[guide]] about caring for cats.' },
    });

    const result = await api<ThinkResponse>('GET', '/api/think?q=feline care&path=guide.md');
    const kit = result.body.data!;
    expect(kit.passages.some((item) => item.path === 'guide.md')).toBe(true);
    const neighborPaths = kit.citations.filter((c) => c.kind === 'neighbor').map((c) => c.path);
    expect(neighborPaths).toContain('diary.md');
  });

  it('does not synthesize (and never 500s) when synthesize=1 but no key is set', async () => {
    await api('POST', '/api/file', {
      body: { path: 'cats.md', content: '# Cats\nFelines purr and chase mice.' },
    });

    const result = await api<ThinkResponse>('GET', '/api/think?q=feline&synthesize=1');
    expect(result.status).toBe(200);
    expect(result.body.data!.answer).toBeUndefined();
  });
});
