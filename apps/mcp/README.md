# @repo/mcp — Vault MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the markdown vault
as tools an AI agent can call. It is a thin client over the HTTP API
(`apps/api`), so every write goes through the same path validation,
optimistic-concurrency checks, and **audit trail** as the web UI.

Agent writes are attributed via the `X-Actor` header (default `agent:mcp`), so
they appear in the human-facing **Activity** feed — the human always sees what
the agent did.

## Tools

| Tool              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `list_notes`      | List all note paths (optionally under a subtree).                 |
| `read_note`       | Read a note's content + etag.                                     |
| `create_note`     | Create a new note.                                                |
| `update_note`     | Overwrite a note (pass `etag` for safe writes).                   |
| `patch_note`      | Append/prepend/replace-section with etag + idempotency + dry-run. |
| `search_notes`    | Full-text and/or tag search.                                      |
| `semantic_search` | Relevance-ranked retrieval (TF-IDF) for RAG.                      |
| `get_backlinks`   | Notes linking to a note via `[[wikilinks]]`.                      |
| `recent_activity` | Read the provenance/audit trail.                                  |
| `create_folder`   | Create a folder.                                                  |
| `move_path`       | Move/rename a note or folder.                                     |
| `delete_path`     | Delete a note or folder.                                          |
| `propose_edit`    | Propose a create/update/delete for human review.                  |
| `list_proposals`  | List proposals + review status (resolve is human).                |

## Run

Start the API first, then the MCP server (stdio transport):

```bash
npm run dev:api                       # terminal A
npm --workspace @repo/mcp run start   # terminal B (or wire into an MCP client)
```

## Configuration

| Env var        | Default                 | Purpose                             |
| -------------- | ----------------------- | ----------------------------------- |
| `API_BASE_URL` | `http://localhost:3001` | Where the vault HTTP API is served. |
| `MCP_ACTOR`    | `agent:mcp`             | Actor label recorded on writes.     |

## Example MCP client config

```json
{
  "mcpServers": {
    "fsbrain-vault": {
      "command": "npx",
      "args": ["tsx", "apps/mcp/src/server.ts"],
      "env": { "API_BASE_URL": "http://localhost:3001" }
    }
  }
}
```
