import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import type { ApiResponse, FileContent, HealthResponse } from '@repo/shared';
import { loadConfig } from './config.js';

const config = loadConfig();

function sendJson<T>(res: http.ServerResponse, statusCode: number, body: ApiResponse<T>) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, {
      success: false,
      error: { code: 'bad_request', message: 'Missing request URL or method.' },
    });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    const data: HealthResponse = {
      status: 'ok',
      contentRoot: config.contentRoot,
      timestamp: new Date().toISOString(),
    };

    sendJson(res, 200, { success: true, data });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/file') {
    const relativePath = url.searchParams.get('path');

    if (!relativePath) {
      sendJson(res, 400, {
        success: false,
        error: { code: 'missing_path', message: 'Query parameter "path" is required.' },
      });
      return;
    }

    const absolutePath = path.resolve(config.contentRoot, relativePath);
    if (!absolutePath.startsWith(config.contentRoot)) {
      sendJson(res, 403, {
        success: false,
        error: { code: 'forbidden_path', message: 'Path must stay within CONTENT_ROOT.' },
      });
      return;
    }

    if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
      sendJson(res, 404, {
        success: false,
        error: { code: 'not_found', message: 'File not found.' },
      });
      return;
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const stats = fs.statSync(absolutePath);

    const data: FileContent = {
      path: relativePath,
      content,
      encoding: 'utf-8',
      lastModified: stats.mtime.toISOString(),
    };

    sendJson(res, 200, { success: true, data });
    return;
  }

  sendJson(res, 404, {
    success: false,
    error: { code: 'not_found', message: 'Endpoint not found.' },
  });
});

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`CONTENT_ROOT resolved to: ${config.contentRoot}`);
});
