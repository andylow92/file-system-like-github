import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { createServer } from '../server';

interface HttpResponse<T = unknown> {
  statusCode: number;
  body: T;
}

function requestJson<T>(
  port: number,
  method: string,
  pathname: string,
  payload?: Record<string, unknown>,
): Promise<HttpResponse<T>> {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode ?? 0,
            body: JSON.parse(raw) as T,
          });
        });
      },
    );

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe('server bootstrap', () => {
  let workspaceRoot = '';
  let originalContentRoot: string | undefined;
  let originalCwd = '';

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'api-server-root-'));
    originalContentRoot = process.env.CONTENT_ROOT;
    originalCwd = process.cwd();
    delete process.env.CONTENT_ROOT;
    process.chdir(workspaceRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalContentRoot === undefined) {
      delete process.env.CONTENT_ROOT;
    } else {
      process.env.CONTENT_ROOT = originalContentRoot;
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('starts and serves file routes when CONTENT_ROOT is unset', async () => {
    const config = loadConfig();
    const server = createServer(config);

    await new Promise<void>((resolve) => server.listen(0, resolve));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server failed to bind a TCP port');
    }

    const port = address.port;

    const health = await requestJson<{ success: boolean; data: { contentRoot: string } }>(port, 'GET', '/health');
    expect(health.statusCode).toBe(200);
    expect(health.body.success).toBe(true);
    expect(health.body.data.contentRoot).toBe(path.join(workspaceRoot, 'content'));

    const createDir = await requestJson<{ success: boolean }>(port, 'POST', '/api/dir', { path: 'docs' });
    expect(createDir.statusCode).toBe(201);
    expect(createDir.body.success).toBe(true);

    const createFile = await requestJson<{ success: boolean }>(port, 'POST', '/api/file', {
      path: 'docs/guide.md',
      content: '# guide',
    });
    expect(createFile.statusCode).toBe(201);
    expect(createFile.body.success).toBe(true);

    const readFile = await requestJson<{ success: boolean; data: { content: string } }>(
      port,
      'GET',
      '/api/file?path=docs/guide.md',
    );
    expect(readFile.statusCode).toBe(200);
    expect(readFile.body.success).toBe(true);
    expect(readFile.body.data.content).toBe('# guide');

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
});
