import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGap, QuestionEntry } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface QuestionsResponse {
  entries: QuestionEntry[];
  gaps: KnowledgeGap[];
}

describe('question log (think gap signal → GET /api/questions)', () => {
  let contentRoot = '';
  let baseUrl = '';
  let server: http.Server | undefined;

  async function api<T>(
    method: string,
    pathname: string,
    options: { body?: unknown; actor?: string } = {},
  ): Promise<{ status: number; body: ApiResponse<T> }> {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.actor ? { 'X-Actor': options.actor } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: (await response.json()) as ApiResponse<T> };
  }

  beforeEach(async () => {
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'questions-root-'));
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

  it('persists each think query with its gap signal and actor', async () => {
    await api('POST', '/api/file', {
      body: { path: 'notes/cooking.md', content: '# Cooking\nPasta and sauces.' },
    });

    // Nothing in the vault covers this — weak coverage with uncovered terms.
    const think = await api('GET', '/api/think?q=kubernetes%20failover', {
      actor: 'agent:test',
    });
    expect(think.status).toBe(200);

    const result = await api<QuestionsResponse>('GET', '/api/questions');
    expect(result.status).toBe(200);
    const { entries } = result.body.data!;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'agent:test',
      query: 'kubernetes failover',
      weakCoverage: true,
    });
    expect(entries[0].uncoveredTerms.length).toBeGreaterThan(0);

    // The log lives beside the audit log, hidden from the tree.
    const raw = await readFile(path.join(contentRoot, '.fsbrain', 'questions.jsonl'), 'utf8');
    expect(raw).toContain('kubernetes failover');
  });

  it('distills recurring uncovered terms into knowledge gaps', async () => {
    await api('GET', '/api/think?q=kubernetes%20failover');
    await api('GET', '/api/think?q=how%20to%20failover%20the%20database');
    await api('GET', '/api/think?q=unrelated%20gardening%20question');

    const result = await api<QuestionsResponse>('GET', '/api/questions');
    const { gaps, entries } = result.body.data!;
    expect(entries).toHaveLength(3);
    // Entries are newest-first.
    expect(entries[0].query).toBe('unrelated gardening question');

    const failover = gaps.find((gap) => gap.term === 'failover');
    expect(failover).toBeDefined();
    expect(failover!.count).toBe(2);
    expect(failover!.queries).toHaveLength(2);

    // A one-off term is below the default recurrence threshold…
    expect(gaps.find((gap) => gap.term === 'gardening')).toBeUndefined();
    // …but surfaces when minCount=1.
    const loose = await api<QuestionsResponse>('GET', '/api/questions?minCount=1');
    expect(loose.body.data!.gaps.find((gap) => gap.term === 'gardening')).toBeDefined();
  });

  it('honors the entry limit without shrinking gap recurrence', async () => {
    await api('GET', '/api/think?q=zeppelin%20maintenance');
    await api('GET', '/api/think?q=zeppelin%20mooring');

    const result = await api<QuestionsResponse>('GET', '/api/questions?limit=1');
    const { entries, gaps } = result.body.data!;
    expect(entries).toHaveLength(1);
    // Gaps still computed over the whole log, not the limited page.
    expect(gaps.find((gap) => gap.term === 'zeppelin')?.count).toBe(2);
  });
});
