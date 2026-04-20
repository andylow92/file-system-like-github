import http from 'node:http';

import type { ApiResponse, HealthResponse } from '@repo/shared';

import { loadConfig } from './config.js';
import { handleFileRoutes } from './routes/files.js';

const config = loadConfig();

function sendJson<T>(res: http.ServerResponse, statusCode: number, body: ApiResponse<T>) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, {
      success: false,
      error: { code: 'bad_request', message: 'Missing request URL or method.' },
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/health')) {
    const data: HealthResponse = {
      status: 'ok',
      contentRoot: config.contentRoot,
      timestamp: new Date().toISOString(),
    };

    sendJson(res, 200, { success: true, data });
    return;
  }

  const routeResult = await handleFileRoutes(req, res);
  if (routeResult.handled) {
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
