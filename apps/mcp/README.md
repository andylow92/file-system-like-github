# @repo/mcp — Vault MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the markdown vault
as tools an AI agent can call. It is a **single-command launcher**: the storage
API (`apps/api`) runs in-process on `127.0.0.1` by default, so an MCP host
(OpenClaw, Claude Desktop, Claude Code, Cursor) only needs to spawn one stdio
process.

Agent writes are attributed via the `X-Actor` header (default `agent:mcp`,
override via `MCP_ACTOR`), so they appear in the human-facing **Activity**
feed and the audit log at `<CONTENT_ROOT>/.fsbrain/audit.jsonl`.

## Tools

| Tool                | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| `list_notes`        | List all note paths (optionally under a subtree).                       |
| `read_note`         | Read a note by path or stable id (returns content + etag + `id`).       |
| `read_block`        | Read a single `^block-id` block + surrounding context.                  |
| `get_block_anchors` | List every `^block-id` anchor in a note.                                |
| `create_note`       | Create a new note.                                                      |
| `update_note`       | Overwrite a note (pass `etag` for safe writes).                         |
| `patch_note`        | append/prepend/replace_section/replace_block/ensure_id, etag + dry-run. |
| `search_notes`      | Full-text and/or tag search.                                            |
| `semantic_search`   | Relevance-ranked retrieval (TF-IDF) for RAG.                            |
| `get_backlinks`     | Notes linking to a note via `[[wikilinks]]` (includes `rel:` type).     |
| `recent_activity`   | Read the provenance/audit trail.                                        |
| `create_folder`     | Create a folder.                                                        |
| `move_path`         | Move/rename a note or folder.                                           |
| `delete_path`       | Delete a note or folder.                                                |
| `propose_edit`      | Propose a create/update/delete for human review.                        |
| `list_proposals`    | List proposals + review status (resolve is human).                      |

## Run

Build once, then launch:

```bash
npm install
npm run build              # produces apps/mcp/dist/server.js
npm run start:agent        # from the repo root — runs `fsbrain-mcp` on stdio
```

The server prints a one-line readiness banner on stderr:

```
fsbrain-mcp ready · mode=embedded · vault=/home/me/.fsbrain/vault · tools=16 · actor=agent:mcp
```

For active development with auto-reload:

```bash
npm --workspace @repo/mcp run dev
```

Or attach to an externally-running API:

```bash
API_BASE_URL=http://localhost:3001 npm --workspace @repo/mcp run start
```

## Configuration

| Env var        | Default              | Purpose                                                          |
| -------------- | -------------------- | ---------------------------------------------------------------- |
| `CONTENT_ROOT` | `~/.fsbrain/vault`   | Vault directory; auto-created on first run.                      |
| `MCP_ACTOR`    | `agent:mcp`          | Actor label recorded on writes.                                  |
| `API_BASE_URL` | _(unset)_            | When set, proxy this URL instead of starting the in-process API. |
| `PORT`         | _(ephemeral)_        | Port for the in-process API (use `0` or omit for any).           |
| `HOST`         | `127.0.0.1` in embed | Bind address for the in-process API.                             |

When the vault is empty on first launch in embedded mode, the server seeds a
`welcome.md` so an MCP host has something to list. (Running `npm run dev:api`
against an empty vault does **not** auto-seed — only the MCP launcher does.)

## Connect an MCP host

Copy-paste config snippets for OpenClaw / Claude Desktop / Claude Code / Cursor:
[`../../docs/CONNECT.md`](../../docs/CONNECT.md).

## Fresh-clone guarantee

`src/__tests__/freshClone.test.ts` spawns the bin as a real stdio child against
a temp `CONTENT_ROOT`, drives it via the official MCP SDK client (`tools/list`

- `create_note` → `read_note` → `search_notes` / `semantic_search` +
  `propose_edit` / `list_proposals` + `recent_activity`), then asserts the write
  landed on disk and in `.fsbrain/audit.jsonl`. Runs in `npm test`.
