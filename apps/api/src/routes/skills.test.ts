import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillSummary } from '@repo/shared';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

describe('GET /api/skills (skill notes — procedural memory)', () => {
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
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'skills-root-'));
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

  it('lists only skill notes and supports the q filter', async () => {
    await api('POST', '/api/file', {
      body: {
        path: 'skills/hotfix.md',
        content: [
          '---',
          'type: skill',
          'name: Release a hotfix',
          'description: Ship a one-line fix safely.',
          'tags: [ops]',
          '---',
          '# Hotfix release',
          '1. Branch from the release tag.',
        ].join('\n'),
      },
    });
    await api('POST', '/api/file', {
      body: { path: 'notes/plain.md', content: '# Plain note\nNot a skill.' },
    });

    const all = await api<SkillSummary[]>('GET', '/api/skills');
    expect(all.status).toBe(200);
    expect(all.body.data).toEqual([
      {
        path: 'skills/hotfix.md',
        name: 'Release a hotfix',
        description: 'Ship a one-line fix safely.',
        tags: ['ops'],
      },
    ]);

    const filtered = await api<SkillSummary[]>('GET', '/api/skills?q=hotfix');
    expect(filtered.body.data!.length).toBe(1);

    const none = await api<SkillSummary[]>('GET', '/api/skills?q=unrelated');
    expect(none.body.data).toEqual([]);
  });

  it('reflects a newly created skill without a restart (cache invalidation)', async () => {
    // Warm the cached index with a skill-free vault.
    const before = await api<SkillSummary[]>('GET', '/api/skills');
    expect(before.body.data).toEqual([]);

    await api('POST', '/api/file', {
      body: {
        path: 'skills/triage.md',
        content: '---\ntype: skill\n---\n# Triage incoming bugs\nLabel, reproduce, prioritize.',
      },
    });

    const after = await api<SkillSummary[]>('GET', '/api/skills');
    expect(after.body.data!.map((skill) => skill.name)).toEqual(['Triage incoming bugs']);
    // Fallback description comes from the first body paragraph line.
    expect(after.body.data![0].description).toBe('Label, reproduce, prioritize.');
  });
});
