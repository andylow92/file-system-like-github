/**
 * MCP server exposing the markdown vault as agent tools.
 *
 * Designed to be launched by an MCP host (e.g. OpenClaw, Claude Desktop) as a
 * single command — so it bundles the storage API in-process by default and
 * only proxies an external API if you explicitly opt in via `API_BASE_URL`.
 *
 * Writes flow through that API and inherit its path validation, optimistic-
 * concurrency, and audit trail. Writes are attributed via the `X-Actor` header
 * (default `agent:mcp`, settable via `MCP_ACTOR`) so they appear in the
 * human-facing Activity feed.
 *
 * Run it standalone:
 *   npm --workspace @repo/mcp run start            # in-process API on 127.0.0.1
 *   API_BASE_URL=http://localhost:3001 npm --workspace @repo/mcp run start
 */
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer as createApiServer, loadConfig, type ServerConfig } from '@repo/api';
import { z } from 'zod';

import type {
  ApiResponse,
  AuditEntry,
  Backlink,
  BlockAnchor,
  EditProposal,
  FileNode,
  SearchMatch,
  SemanticHit,
} from '@repo/shared';

const EXPLICIT_API_BASE_URL = process.env.API_BASE_URL?.replace(/\/$/, '');
const ACTOR = process.env.MCP_ACTOR ?? 'agent:mcp';

class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AppContext {
  apiBaseUrl: string;
  /** Resolved vault path; `undefined` when proxying an external API. */
  contentRoot?: string;
  /** Set when this process started the API itself; `undefined` if attached to an external API. */
  embeddedServer?: http.Server;
}

function createApiClient(context: AppContext) {
  return async function apiRequest<T>(
    pathname: string,
    init?: RequestInit & { actor?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (init?.actor) {
      headers['X-Actor'] = ACTOR;
    }

    const response = await fetch(`${context.apiBaseUrl}${pathname}`, { ...init, headers });
    const payload = (await response.json()) as ApiResponse<T>;

    if (!response.ok || !payload.success) {
      const error = payload.success
        ? { code: 'unknown_error', message: `Request failed (${response.status})` }
        : payload.error;
      throw new ApiError(error.message, error.code);
    }

    return payload.data;
  };
}

function flattenFiles(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.isDirectory) {
      paths.push(...flattenFiles(node.children ?? []));
    } else {
      paths.push(node.path);
    }
  }
  return paths;
}

/** Wrap a handler so API errors become readable tool errors instead of crashes. */
function tool<Args>(handler: (args: Args) => Promise<unknown>) {
  return async (args: Args) => {
    try {
      const result = await handler(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { isError: true, content: [{ type: 'text' as const, text: `Error: ${message}` }] };
    }
  };
}

/**
 * Start an in-process copy of the storage API on 127.0.0.1, ephemeral port (or
 * `PORT`). Returns the base URL the MCP tools should hit, the chosen
 * `ServerConfig`, and the underlying `http.Server` so we can close it on shutdown.
 */
async function startEmbeddedApi(): Promise<{
  baseUrl: string;
  server: http.Server;
  config: ServerConfig;
}> {
  // Read the config the API will use (host/contentRoot/port). We then override
  // host+port so the embedded server binds to a private loopback address and
  // an ephemeral port by default.
  const baseConfig = loadConfig();
  const port = Number(process.env.PORT ?? 0);
  const config: ServerConfig = { ...baseConfig, host: '127.0.0.1', port };
  const server = createApiServer(config);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Embedded API failed to bind a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    config,
  };
}

/** Drop a friendly note in the vault on its very first launch so it isn't empty. */
async function maybeSeedWelcome(contentRoot: string): Promise<void> {
  try {
    const entries = await fs.readdir(contentRoot);
    const visible = entries.filter((name) => !name.startsWith('.'));
    if (visible.length > 0) {
      return;
    }
  } catch {
    return;
  }

  const welcomePath = path.join(contentRoot, 'welcome.md');
  const body = [
    '# Welcome to fsbrain',
    '',
    'This vault is a folder of plain markdown files that humans edit and agents',
    'can read, search, link, and write through an MCP server. Every agent write is',
    'recorded in the audit log (`.fsbrain/audit.jsonl`) so you can see what changed.',
    '',
    'Start by editing this note, or create new ones — the agent can find them with',
    '`search_notes` / `semantic_search`.',
    '',
  ].join('\n');

  try {
    await fs.writeFile(welcomePath, body, { encoding: 'utf8', flag: 'wx' });
  } catch {
    // Already exists, or unwritable — either way we won't fight the user.
  }
}

function registerTools(server: McpServer, apiRequest: ReturnType<typeof createApiClient>) {
  server.tool(
    'list_notes',
    'List all markdown note paths in the vault (optionally under a subtree).',
    { path: z.string().optional().describe('Subtree path; omit for the whole vault.') },
    tool(async ({ path: subtree }: { path?: string }) => {
      const query = subtree ? `?path=${encodeURIComponent(subtree)}` : '';
      const tree = await apiRequest<FileNode[]>(`/api/tree${query}`);
      return { paths: flattenFiles(tree) };
    }),
  );

  server.tool(
    'read_note',
    'Read the markdown content of a note by its logical path or its stable id.',
    {
      path: z.string().optional().describe('Logical path, e.g. "notes/idea.md".'),
      id: z.string().optional().describe('Stable note id from frontmatter `id:`.'),
    },
    tool(async ({ path: notePath, id }: { path?: string; id?: string }) => {
      if (!notePath && !id) {
        throw new Error('Either path or id is required');
      }
      const params = new URLSearchParams();
      if (notePath) params.set('path', notePath);
      else if (id) params.set('id', id);
      return apiRequest(`/api/file?${params.toString()}`);
    }),
  );

  server.tool(
    'read_block',
    'Read a single block (paragraph / list-item / heading section) carrying a ' +
      '`^block-id` anchor, plus a short surrounding context. Address the note by ' +
      'path or by stable id.',
    {
      path: z.string().optional().describe('Logical path, e.g. "notes/idea.md".'),
      id: z.string().optional().describe('Stable note id (frontmatter `id:`).'),
      block: z.string().describe('Anchor id without the leading `^`, e.g. "claim-1".'),
    },
    tool(async ({ path: notePath, id, block }: { path?: string; id?: string; block: string }) => {
      if (!notePath && !id) {
        throw new Error('Either path or id is required');
      }
      const params = new URLSearchParams();
      if (notePath) params.set('path', notePath);
      else if (id) params.set('id', id);
      params.set('block', block);
      return apiRequest(`/api/block?${params.toString()}`);
    }),
  );

  server.tool(
    'get_block_anchors',
    'List every `^block-id` anchor in a note. Useful before patching by block.',
    {
      path: z.string().optional().describe('Logical path, e.g. "notes/idea.md".'),
      id: z.string().optional().describe('Stable note id (frontmatter `id:`).'),
    },
    tool(async ({ path: notePath, id }: { path?: string; id?: string }) => {
      if (!notePath && !id) {
        throw new Error('Either path or id is required');
      }
      const params = new URLSearchParams();
      if (notePath) params.set('path', notePath);
      else if (id) params.set('id', id);
      return apiRequest<{ path: string; anchors: BlockAnchor[] }>(
        `/api/block-anchors?${params.toString()}`,
      );
    }),
  );

  server.tool(
    'create_note',
    'Create a new markdown note. Fails if it already exists.',
    {
      path: z.string().describe('Logical path ending in .md.'),
      content: z.string().default('').describe('Initial markdown content.'),
    },
    tool(async ({ path: notePath, content }: { path: string; content: string }) => {
      return apiRequest('/api/file', {
        method: 'POST',
        body: JSON.stringify({ path: notePath, content }),
        actor: true,
      });
    }),
  );

  server.tool(
    'update_note',
    'Overwrite an existing note. Pass the current etag for safe optimistic-concurrency writes.',
    {
      path: z.string(),
      content: z.string(),
      etag: z.string().optional().describe('Etag from read_note; rejects the write if stale.'),
    },
    tool(
      async ({
        path: notePath,
        content,
        etag,
      }: {
        path: string;
        content: string;
        etag?: string;
      }) => {
        return apiRequest('/api/file', {
          method: 'PUT',
          body: JSON.stringify({ path: notePath, content, etag }),
          actor: true,
        });
      },
    ),
  );

  server.tool(
    'search_notes',
    'Full-text and/or tag search across the vault. Provide query, tag, or both.',
    {
      query: z.string().optional().describe('Case-insensitive text to search note bodies for.'),
      tag: z.string().optional().describe('Tag name (without #) to filter by.'),
      limit: z.number().optional(),
    },
    tool(async ({ query, tag, limit }: { query?: string; tag?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (tag) params.set('tag', tag);
      if (limit) params.set('limit', String(limit));
      return apiRequest<SearchMatch[]>(`/api/search?${params.toString()}`);
    }),
  );

  server.tool(
    'semantic_search',
    'Relevance-ranked retrieval: find the note passages most "about" a query, ' +
      'even without exact keyword matches. Best for RAG-style context gathering.',
    {
      query: z.string().describe('A natural-language description of what to find.'),
      limit: z.number().optional(),
    },
    tool(async ({ query, limit }: { query: string; limit?: number }) => {
      const params = new URLSearchParams({ q: query });
      if (limit) params.set('limit', String(limit));
      return apiRequest<SemanticHit[]>(`/api/semantic-search?${params.toString()}`);
    }),
  );

  server.tool(
    'get_backlinks',
    'List notes that link to the given note via [[wikilinks]].',
    { path: z.string() },
    tool(async ({ path: notePath }: { path: string }) => {
      return apiRequest<Backlink[]>(`/api/backlinks?path=${encodeURIComponent(notePath)}`);
    }),
  );

  server.tool(
    'recent_activity',
    'Read the provenance/audit trail of recent vault changes (who changed what).',
    {
      path: z.string().optional().describe('Filter to a single note path.'),
      limit: z.number().optional(),
    },
    tool(async ({ path: notePath, limit }: { path?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (notePath) params.set('path', notePath);
      if (limit) params.set('limit', String(limit));
      const query = params.toString();
      return apiRequest<AuditEntry[]>(`/api/audit${query ? `?${query}` : ''}`);
    }),
  );

  server.tool(
    'create_folder',
    'Create a folder in the vault.',
    { path: z.string() },
    tool(async ({ path: folderPath }: { path: string }) => {
      return apiRequest('/api/dir', {
        method: 'POST',
        body: JSON.stringify({ path: folderPath }),
        actor: true,
      });
    }),
  );

  server.tool(
    'move_path',
    'Move or rename a note or folder.',
    { fromPath: z.string(), toPath: z.string() },
    tool(async ({ fromPath, toPath }: { fromPath: string; toPath: string }) => {
      return apiRequest('/api/path', {
        method: 'PATCH',
        body: JSON.stringify({ fromPath, toPath }),
        actor: true,
      });
    }),
  );

  server.tool(
    'delete_path',
    'Delete a note or folder. Set recursive to remove a non-empty folder.',
    { path: z.string(), recursive: z.boolean().optional() },
    tool(async ({ path: targetPath, recursive }: { path: string; recursive?: boolean }) => {
      const params = new URLSearchParams({
        path: targetPath,
        recursive: String(Boolean(recursive)),
      });
      return apiRequest(`/api/path?${params.toString()}`, { method: 'DELETE', actor: true });
    }),
  );

  server.tool(
    'patch_note',
    'Granular edits to a note: append text, prepend text (after frontmatter), ' +
      'replace the body under a heading, replace the block carrying a ' +
      '`^block-id` anchor, or ensure the note has a stable `id:` in frontmatter. ' +
      'Address the note by `path` or by stable `id`. Pass `etag` (from read_note) ' +
      'for safe optimistic-concurrency writes, an `idempotencyKey` to make a ' +
      'retry a no-op, or `dryRun: true` to preview the result without writing.',
    {
      path: z.string().optional(),
      id: z.string().optional().describe('Stable note id (frontmatter `id:`).'),
      op: z.discriminatedUnion('type', [
        z
          .object({ type: z.literal('append'), text: z.string() })
          .describe('Append `text` to the end of the note.'),
        z
          .object({ type: z.literal('prepend'), text: z.string() })
          .describe('Insert `text` at the top; lands after frontmatter if present.'),
        z
          .object({
            type: z.literal('replace_section'),
            heading: z.string().describe('The full heading line, e.g. "## Tasks".'),
            body: z.string().describe('New body to insert under the heading.'),
          })
          .describe('Replace the body under a heading; siblings are kept.'),
        z
          .object({
            type: z.literal('replace_block'),
            blockId: z.string().describe('Anchor id without the leading `^`.'),
            body: z.string().describe('New body to substitute for the block.'),
          })
          .describe('Replace the paragraph/list-item/heading-section carrying `^blockId`.'),
        z
          .object({
            type: z.literal('ensure_id'),
            id: z
              .string()
              .optional()
              .describe('Specific id to assign; a UUID is generated when omitted.'),
          })
          .describe('Add an `id:` to frontmatter if missing (idempotent).'),
      ]),
      etag: z.string().optional().describe('Etag from read_note; rejects the patch if stale.'),
      idempotencyKey: z
        .string()
        .optional()
        .describe('Replay protection — the same key returns the original result without writing.'),
      dryRun: z.boolean().optional().describe('Compute the result without writing.'),
    },
    tool(
      async (args: {
        path?: string;
        id?: string;
        op:
          | { type: 'append'; text: string }
          | { type: 'prepend'; text: string }
          | { type: 'replace_section'; heading: string; body: string }
          | { type: 'replace_block'; blockId: string; body: string }
          | { type: 'ensure_id'; id?: string };
        etag?: string;
        idempotencyKey?: string;
        dryRun?: boolean;
      }) => {
        if (!args.path && !args.id) {
          throw new Error('Either path or id is required');
        }
        return apiRequest('/api/file', {
          method: 'PATCH',
          body: JSON.stringify(args),
          actor: true,
        });
      },
    ),
  );

  server.tool(
    'propose_edit',
    'Propose a create/update/delete for human review instead of writing directly. ' +
      'Use this when changes should be approved by the human before they land.',
    {
      action: z.enum(['create', 'update', 'delete']),
      path: z.string(),
      content: z.string().optional().describe('Required for create/update.'),
      baseEtag: z
        .string()
        .optional()
        .describe('Etag from read_note, so a stale update is rejected on approval.'),
      note: z.string().optional().describe('Why you are proposing this change.'),
    },
    tool(
      async (args: {
        action: 'create' | 'update' | 'delete';
        path: string;
        content?: string;
        baseEtag?: string;
        note?: string;
      }) =>
        apiRequest('/api/proposals', {
          method: 'POST',
          body: JSON.stringify(args),
          actor: true,
        }),
    ),
  );

  server.tool(
    'list_proposals',
    'List edit proposals and their review status (pending/approved/rejected). ' +
      'Approval/rejection is a human action and is not available to agents.',
    { status: z.enum(['pending', 'approved', 'rejected']).optional() },
    tool(async ({ status }: { status?: 'pending' | 'approved' | 'rejected' }) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const query = params.toString();
      return apiRequest<EditProposal[]>(`/api/proposals${query ? `?${query}` : ''}`);
    }),
  );
}

/** Build the MCP server + tool surface against the chosen API base URL. */
export function buildServer(context: AppContext): McpServer {
  const apiRequest = createApiClient(context);
  const server = new McpServer({ name: 'fsbrain-vault', version: '0.1.0' });
  registerTools(server, apiRequest);
  return server;
}

/**
 * Bootstrap the runtime: start an in-process API if no external one was given,
 * seed a welcome note in an empty vault, then return the wired-up MCP server.
 * Exported so tests can drive it without spawning the bin.
 */
export async function bootstrap(): Promise<{ server: McpServer; context: AppContext }> {
  let context: AppContext;
  if (EXPLICIT_API_BASE_URL) {
    context = { apiBaseUrl: EXPLICIT_API_BASE_URL };
  } else {
    const { baseUrl, server, config } = await startEmbeddedApi();
    context = { apiBaseUrl: baseUrl, contentRoot: config.contentRoot, embeddedServer: server };
    await maybeSeedWelcome(config.contentRoot);
  }
  return { server: buildServer(context), context };
}

function installShutdownHandlers(context: AppContext): void {
  const close = async () => {
    if (context.embeddedServer) {
      await new Promise<void>((resolve) => context.embeddedServer?.close(() => resolve()));
    }
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

/** Count the tools the server has registered, for the startup banner. */
function countRegisteredTools(server: McpServer): number {
  const internal = server as unknown as {
    _registeredTools?: Record<string, unknown>;
  };
  return internal._registeredTools ? Object.keys(internal._registeredTools).length : 0;
}

async function main() {
  const { server, context } = await bootstrap();
  installShutdownHandlers(context);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const mode = context.embeddedServer ? 'embedded' : 'proxied';
  const vault = context.contentRoot ?? '(external API)';
  const tools = countRegisteredTools(server);
  // Stdio reserves stdout for MCP frames; status goes to stderr.
  // eslint-disable-next-line no-console
  console.error(
    `fsbrain-mcp ready · mode=${mode} · vault=${vault} · tools=${tools} · actor=${ACTOR}`,
  );
}

// Run as an entry point (CLI / bin / `tsx src/server.ts`) but stay quiet when
// imported as a library (e.g. from tests that drive `bootstrap()` themselves).
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (entryPath && entryPath === selfPath) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('fsbrain MCP server failed to start:', error);
    process.exit(1);
  });
}
