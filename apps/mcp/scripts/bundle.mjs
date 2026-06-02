#!/usr/bin/env node
/**
 * Bundle the MCP entry point into a single self-contained `dist/server.js`,
 * so OpenClaw (and any other MCP host) can spawn it with one `node dist/...`
 * command — no workspace context or `tsx` runtime required.
 *
 * Strategy: inline the in-repo workspace deps (`@repo/api`, `@repo/shared`)
 * and the pure-JS `zod` dep so the runtime dependency surface stays tight.
 * The MCP SDK has its own native-ish layout and resolves cleanly from
 * `node_modules`, so we keep it external.
 */
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

await build({
  entryPoints: [path.join(root, 'src/server.ts')],
  outfile: path.join(root, 'dist/server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@modelcontextprotocol/sdk'],
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});

chmodSync(path.join(root, 'dist/server.js'), 0o755);
