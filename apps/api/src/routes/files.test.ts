import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ApiError {
  code: string;
  message: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

describe('PATCH /api/path', () => {
  let contentRoot = '';
  let baseUrl = '';
  let server: http.Server | undefined;

  beforeEach(async () => {
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'api-routes-content-root-'));
    process.env.CONTENT_ROOT = contentRoot;
    vi.resetModules();

    const { handleFileRoutes } = await import('./files');

    server = http.createServer(async (req, res) => {
      const handled = await handleFileRoutes(req, res);
      if (!handled.handled) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: { code: 'not_found', message: 'Endpoint not found.' } }));
      }
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine server address for tests');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await rm(contentRoot, { recursive: true, force: true });
  });

  async function patchPath(fromPath: string, toPath: string): Promise<Response> {
    return fetch(`${baseUrl}/api/path`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromPath, toPath }),
    });
  }

  it('moves markdown files when both source and destination paths are .md', async () => {
    await mkdir(path.join(contentRoot, 'notes'), { recursive: true });
    await writeFile(path.join(contentRoot, 'notes/source.md'), '# source', 'utf8');

    const response = await patchPath('notes/source.md', 'notes/destination.md');
    const body = (await response.json()) as ApiResponse<{ fromPath: string; toPath: string }>;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ fromPath: 'notes/source.md', toPath: 'notes/destination.md' });

    await expect(readFile(path.join(contentRoot, 'notes/destination.md'), 'utf8')).resolves.toBe('# source');
    await expect(stat(path.join(contentRoot, 'notes/source.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects markdown file moves when destination path is not .md', async () => {
    await mkdir(path.join(contentRoot, 'notes'), { recursive: true });
    await writeFile(path.join(contentRoot, 'notes/source.md'), '# source', 'utf8');

    const response = await patchPath('notes/source.md', 'notes/destination.txt');
    const body = (await response.json()) as ApiResponse<unknown>;

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatchObject({
      code: 'invalid_path',
      message: 'Only .md files are allowed for this operation',
    });

    await expect(readFile(path.join(contentRoot, 'notes/source.md'), 'utf8')).resolves.toBe('# source');
    await expect(stat(path.join(contentRoot, 'notes/destination.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('still supports directory moves', async () => {
    await mkdir(path.join(contentRoot, 'docs/guides'), { recursive: true });
    await writeFile(path.join(contentRoot, 'docs/guides/intro.md'), '# intro', 'utf8');

    const response = await patchPath('docs', 'archive/docs');
    const body = (await response.json()) as ApiResponse<{ fromPath: string; toPath: string }>;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ fromPath: 'docs', toPath: 'archive/docs' });

    await expect(readFile(path.join(contentRoot, 'archive/docs/guides/intro.md'), 'utf8')).resolves.toBe('# intro');
    await expect(stat(path.join(contentRoot, 'docs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
