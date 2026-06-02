/**
 * Fresh-clone end-to-end test for the MCP server.
 *
 * The proof that "tell an agent to clone the repo and use the brain" works:
 * spawn the self-contained MCP server as a real stdio child process
 * (`node node_modules/tsx/dist/cli.mjs apps/mcp/src/server.ts`), drive it via
 * the real MCP SDK client, run a round-trip of writes/reads/search/proposals,
 * and assert the write landed both in the vault on disk and in the audit log.
 *
 * Tests intentionally do not depend on `npm run build` — they exercise the
 * same code path an MCP host like OpenClaw uses minus the bundled bin. The
 * bundled bin (`dist/server.js`) is covered by `npm run build` and the bin
 * config in `package.json`.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuditEntry, EditProposal, SearchMatch, SemanticHit } from '@repo/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(mcpRoot, '..', '..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = path.join(mcpRoot, 'src', 'server.ts');

interface ContentResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Decode the JSON payload our `tool()` wrapper packs into a single text block. */
function decode<T = unknown>(result: ContentResult): T {
  expect(result.isError).not.toBe(true);
  const block = result.content[0];
  expect(block.type).toBe('text');
  return JSON.parse(block.text) as T;
}

describe('fresh-clone MCP end-to-end', () => {
  let vault = '';
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), 'fsbrain-fresh-clone-'));
  });

  afterEach(async () => {
    if (client) {
      await client.close().catch(() => undefined);
      client = undefined;
    }
    if (transport) {
      await transport.close().catch(() => undefined);
      transport = undefined;
    }
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('boots from a temp vault, lists tools, round-trips writes, and records provenance', async () => {
    transport = new StdioClientTransport({
      // Drive the bin via tsx so the test doesn't depend on a prior `npm run build`.
      // A separate guarantee (npm script + bin field) covers the bundled `dist/server.js` path.
      command: process.execPath,
      args: [tsxCli, serverEntry],
      // Force the embedded-API mode and point it at our temp vault.
      env: {
        ...process.env,
        CONTENT_ROOT: vault,
        API_BASE_URL: '',
        MCP_ACTOR: 'agent:fresh-clone',
      },
      // Surface server stderr (readiness banner, errors) on the test runner stderr.
      stderr: 'inherit',
    });
    client = new Client({ name: 'fresh-clone-test', version: '0.0.0' });
    await client.connect(transport);

    // 1) tools/list — assert the expected tool surface is present.
    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual(
      [
        'create_folder',
        'create_note',
        'delete_path',
        'get_backlinks',
        'get_block_anchors',
        'list_notes',
        'list_proposals',
        'move_path',
        'patch_note',
        'propose_edit',
        'read_block',
        'read_note',
        'recent_activity',
        'search_notes',
        'semantic_search',
        'update_note',
      ].sort(),
    );

    // 2) create_note → read_note round-trip.
    const createResult = (await client.callTool({
      name: 'create_note',
      arguments: {
        path: 'notes/idea.md',
        content: '# Brainstorm\n\nKey idea: vaults can serve agents and humans equally.\n',
      },
    })) as ContentResult;
    const created = decode<{ path: string; etag: string }>(createResult);
    expect(created.path).toBe('notes/idea.md');
    expect(created.etag).toBeTypeOf('string');

    const readResult = (await client.callTool({
      name: 'read_note',
      arguments: { path: 'notes/idea.md' },
    })) as ContentResult;
    const read = decode<{ content: string }>(readResult);
    expect(read.content).toContain('Key idea');

    // 3) The write must land on disk under the temp CONTENT_ROOT.
    const onDisk = await fs.readFile(path.join(vault, 'notes', 'idea.md'), 'utf8');
    expect(onDisk).toContain('Key idea');

    // 4) search_notes should find the new note.
    const searchResult = (await client.callTool({
      name: 'search_notes',
      arguments: { query: 'brainstorm' },
    })) as ContentResult;
    const matches = decode<SearchMatch[]>(searchResult);
    expect(matches.map((match) => match.path)).toContain('notes/idea.md');

    // 5) semantic_search should also find it.
    const semanticResult = (await client.callTool({
      name: 'semantic_search',
      arguments: { query: 'vault for agents and humans', limit: 5 },
    })) as ContentResult;
    const hits = decode<SemanticHit[]>(semanticResult);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((hit) => hit.path)).toContain('notes/idea.md');

    // 6) propose_edit + list_proposals — agent-driven review queue.
    const proposeResult = (await client.callTool({
      name: 'propose_edit',
      arguments: {
        action: 'update',
        path: 'notes/idea.md',
        content: '# Brainstorm\n\nRefined: vaults can serve agents and humans equally.\n',
        baseEtag: created.etag,
        note: 'tighter wording',
      },
    })) as ContentResult;
    const proposal = decode<EditProposal>(proposeResult);
    expect(proposal.status).toBe('pending');
    expect(proposal.actor).toBe('agent:fresh-clone');

    const proposalsResult = (await client.callTool({
      name: 'list_proposals',
      arguments: { status: 'pending' },
    })) as ContentResult;
    const proposals = decode<EditProposal[]>(proposalsResult);
    expect(proposals.map((p) => p.id)).toContain(proposal.id);

    // 7) recent_activity exposes the audit log via MCP and matches the on-disk log.
    const auditResult = (await client.callTool({
      name: 'recent_activity',
      arguments: { path: 'notes/idea.md' },
    })) as ContentResult;
    const audit = decode<AuditEntry[]>(auditResult);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].actor).toBe('agent:fresh-clone');
    expect(audit[0].action).toBe('create');
    expect(audit[0].path).toBe('notes/idea.md');

    const auditFile = path.join(vault, '.fsbrain', 'audit.jsonl');
    const auditRaw = await fs.readFile(auditFile, 'utf8');
    const auditLines = auditRaw.trim().split('\n').filter(Boolean);
    expect(auditLines.length).toBeGreaterThan(0);
    const lastEntry = JSON.parse(auditLines[auditLines.length - 1]) as AuditEntry;
    expect(lastEntry.actor).toBe('agent:fresh-clone');
    expect(lastEntry.path).toBe('notes/idea.md');
  });

  it('starts via `node dist/server.js` when the bin has been built', async () => {
    // Skip silently when the bundle hasn't been produced — `npm run build` is
    // its own gate. The fresh-clone test above already exercises the same code
    // path via `tsx`; this just confirms the published bin works end-to-end.
    const distEntry = path.join(mcpRoot, 'dist', 'server.js');
    try {
      await fs.access(distEntry);
    } catch {
      return;
    }

    // Probe with a one-shot child: spawn, give it a short window to print the
    // readiness banner, then terminate. The banner proves the bin imports and
    // boots the embedded API cleanly.
    const child = spawn(process.execPath, [distEntry], {
      env: {
        ...process.env,
        CONTENT_ROOT: vault,
        API_BASE_URL: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const banner = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Timed out waiting for readiness banner; stderr was:\n${stderr}`));
      }, 10000);
      const onData = (chunk: string) => {
        stderr += chunk;
        if (stderr.includes('fsbrain-mcp ready')) {
          clearTimeout(timeout);
          child.stderr.off('data', onData);
          resolve(stderr);
        }
      };
      child.stderr.on('data', onData);
      child.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    expect(banner).toMatch(/fsbrain-mcp ready/);
    expect(banner).toMatch(/mode=embedded/);

    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  });
});
