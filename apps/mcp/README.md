# @repo/mcp — Vault MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the markdown vault
as tools an AI agent can call. The storage API runs **in-process** by default,
so the server is a single self-contained `node`-launchable command — perfect
for MCP hosts like **OpenClaw** or Claude Desktop that spawn one process per
server. Point at an already-running API instead by setting `API_BASE_URL`.

Agent writes are attributed via the `X-Actor` header (default `agent:mcp`,
override with `MCP_ACTOR`), so they appear in the human-facing **Activity**
feed — the human always sees what the agent did.

## Tools

| Tool              | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `list_notes`      | List all note paths (optionally under a subtree).                       |
| `read_note`       | Read a note's content + etag.                                           |
| `create_note`     | Create a new note.                                                      |
| `update_note`     | Overwrite a note (pass `etag` for safe writes).                         |
| `search_notes`    | Full-text and/or tag search.                                            |
| `semantic_search` | Relevance-ranked retrieval (TF-IDF) for RAG.                            |
| `get_backlinks`   | Notes linking to a note via `[[wikilinks]]`.                            |
| `recent_activity` | Read the provenance/audit trail.                                        |
| `create_folder`   | Create a folder.                                                        |
| `move_path`       | Move/rename a note or folder.                                           |
| `delete_path`     | Delete a note or folder. (Use `recursive: true` for non-empty folders.) |

`update_note` and `move_path` reject stale writes via the API's optimistic
concurrency check. There is **no** `resolve` tool: edit-proposal resolution is
human-only by design.

## Build & run

The dev workflow uses `tsx` for fast iteration; the production bin is a single
bundled file with a `#!/usr/bin/env node` shebang.

```bash
# dev (watch + auto-reload)
npm --workspace @repo/mcp run dev

# build the bin (-> apps/mcp/dist/server.js)
npm --workspace @repo/mcp run build

# run the built bin
npm --workspace @repo/mcp run start
```

After building, the bin is reachable as `fsbrain-mcp` (npm `bin`) or directly
as `node apps/mcp/dist/server.js`.

## Configuration

| Env var        | Default                | Purpose                                                                                     |
| -------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `CONTENT_ROOT` | `~/.fsbrain/vault`     | Where the vault lives. The directory is auto-created (`mkdir -p`) on startup.               |
| `API_BASE_URL` | _(unset → in-process)_ | If set, proxy to that API instead of starting one. The in-process API binds to `127.0.0.1`. |
| `PORT`         | _(ephemeral)_          | Force the embedded API to listen on a specific port.                                        |
| `MCP_ACTOR`    | `agent:mcp`            | Actor label recorded on every write (`X-Actor`).                                            |

On first launch in an empty vault, the server seeds a `welcome.md` so the agent
has something to find.

## Run under OpenClaw

OpenClaw spawns each MCP server as a child process and reads the definitions
from `~/.openclaw/openclaw.json` under the `mcp.servers` block
(see [docs.openclaw.ai/cli/mcp](https://docs.openclaw.ai/cli/mcp)).

Add this entry to `~/.openclaw/openclaw.json` (adjust the absolute paths):

```json
{
  "mcp": {
    "servers": {
      "fsbrain-vault": {
        "command": "node",
        "args": ["/abs/path/to/file-system-like-github/apps/mcp/dist/server.js"],
        "env": {
          "CONTENT_ROOT": "/abs/path/to/your/vault",
          "MCP_ACTOR": "agent:openclaw"
        }
      }
    }
  }
}
```

Or register it from the CLI (same effect; OpenClaw writes the JSON for you):

```bash
openclaw mcp add fsbrain-vault \
  --command node \
  --arg /abs/path/to/file-system-like-github/apps/mcp/dist/server.js \
  --env CONTENT_ROOT=/abs/path/to/your/vault \
  --env MCP_ACTOR=agent:openclaw
openclaw mcp doctor fsbrain-vault --probe
```

`openclaw mcp doctor --probe` does both static checks (resolve `node`, verify
`cwd`) and a live connection probe; a successful probe means OpenClaw can list
the 11 tools above.

Notes:

- Setting `MCP_ACTOR=agent:openclaw` tags every write OpenClaw makes through
  the server in the audit log (`CONTENT_ROOT/.fsbrain/audit.jsonl`) and the web
  **Activity** tab — humans can always see which agent did what.
- Build the bundle (`npm --workspace @repo/mcp run build`) before registering
  with OpenClaw — `dist/server.js` is the artifact OpenClaw will spawn.
- Leave `API_BASE_URL` unset: the bin will start the storage API itself on
  `127.0.0.1` and an ephemeral port. Only set it if you also run
  `npm run dev:api` and want both the web UI and OpenClaw against one API.

## Run under Claude Desktop

Same self-contained bin, Claude-Desktop schema (`mcpServers` at the top level):

```json
{
  "mcpServers": {
    "fsbrain-vault": {
      "command": "node",
      "args": ["/abs/path/to/file-system-like-github/apps/mcp/dist/server.js"],
      "env": {
        "CONTENT_ROOT": "/abs/path/to/your/vault",
        "MCP_ACTOR": "agent:claude-desktop"
      }
    }
  }
}
```
