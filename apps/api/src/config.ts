import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ServerConfig {
  port: number;
  /** Optional bind address; defaults to Node's default (all interfaces). */
  host?: string;
  contentRoot: string;
}

/**
 * A vault path that works without configuration: under the user's home
 * directory so a fresh `npm run dev:api` (or an OpenClaw-launched MCP entry
 * with no `CONTENT_ROOT` set) lands in a stable, predictable location.
 */
export function defaultContentRoot(): string {
  return path.join(os.homedir(), '.fsbrain', 'vault');
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST?.trim() || undefined;
  const contentRoot = path.resolve(process.env.CONTENT_ROOT ?? defaultContentRoot());

  return {
    port,
    host,
    contentRoot,
  };
}

/** Make sure `CONTENT_ROOT` exists before any storage code touches it. */
export function ensureContentRoot(contentRoot: string): void {
  mkdirSync(contentRoot, { recursive: true });
}
