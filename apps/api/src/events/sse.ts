import type http from 'node:http';

import type { EventBus } from './eventBus.js';

/**
 * Server-Sent Events endpoint. Subscribes to the EventBus and streams each
 * VaultEvent as a `data: <json>\n\n` frame. Sends periodic heartbeat comments
 * so proxies and clients keep the connection open, and cleans up on disconnect.
 *
 * No buffering or compression is applied to this route — events must flush to
 * the client the instant they are published.
 */
const HEARTBEAT_MS = 15000;

export function handleEventStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  eventBus: EventBus,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering (e.g. nginx) so events are not held back.
    'X-Accel-Buffering': 'no',
  });
  // An initial comment opens the stream immediately.
  res.write(': connected\n\n');

  const unsubscribe = eventBus.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);
  // The heartbeat alone must not keep the process alive.
  heartbeat.unref?.();

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  req.on('close', cleanup);
}
