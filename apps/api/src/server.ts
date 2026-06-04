import http from 'node:http';

import type { ApiResponse, HealthResponse } from '@repo/shared';

import { ensureContentRoot, loadConfig } from './config.js';
import { createEventBus } from './events/eventBus.js';
import { handleEventStream } from './events/sse.js';
import { createVaultWatcher } from './events/watcher.js';
import { handleFileRoutes, type PatchFileResponse } from './routes/files.js';
import { createAuditLog } from './storage/auditLog.js';
import { createFileRepository } from './storage/fileRepository.js';
import { createIdempotencyCache } from './storage/idempotencyCache.js';
import { createPathResolver } from './storage/pathResolver.js';
import { createProposalStore } from './storage/proposalStore.js';

export { loadConfig, ensureContentRoot, defaultContentRoot } from './config.js';
export type { ServerConfig } from './config.js';

export function createServer(config = loadConfig()): http.Server {
  ensureContentRoot(config.contentRoot);
  const pathResolver = createPathResolver(config.contentRoot);
  const repository = createFileRepository(pathResolver);
  const auditLog = createAuditLog(config.contentRoot);
  const proposalStore = createProposalStore(config.contentRoot);
  const patchIdempotency = createIdempotencyCache<PatchFileResponse>();
  const eventBus = createEventBus();
  // Surface out-of-band edits (direct file writes, git, another process) so the
  // human's view stays live even for changes that never hit the API.
  const watcher = createVaultWatcher({ contentRoot: config.contentRoot, eventBus });

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

    if (req.method === 'GET' && req.url.startsWith('/api/events')) {
      handleEventStream(req, res, eventBus);
      return;
    }

    const routeResult = await handleFileRoutes(req, res, {
      repository,
      pathResolver,
      auditLog,
      proposalStore,
      patchIdempotency,
      eventBus,
    });
    if (routeResult.handled) {
      return;
    }

    sendJson(res, 404, {
      success: false,
      error: { code: 'not_found', message: 'Endpoint not found.' },
    });
  });

  // Tear down the watcher (and its bus subscription) when the server closes so
  // tests and short-lived embedded instances don't leak fs.watch handles.
  server.on('close', () => watcher.close());
  return server;
}

export function startServer(config = loadConfig()): http.Server {
  const server = createServer(config);
  const listener = () => {
    const address = server.address();
    const bound =
      typeof address === 'object' && address ? `${address.address}:${address.port}` : config.port;
    // eslint-disable-next-line no-console
    console.log(`API server listening on http://${bound}`);
    // eslint-disable-next-line no-console
    console.log(`CONTENT_ROOT resolved to: ${config.contentRoot}`);
  };

  if (config.host) {
    server.listen(config.port, config.host, listener);
  } else {
    server.listen(config.port, listener);
  }
  return server;
}
