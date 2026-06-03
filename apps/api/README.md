# API

The API exposes filesystem-backed endpoints for GitHub-like tree browsing and Notion-style content editing.

## Endpoints

### `GET /health`

Simple service health check.

### `GET /api/tree?path=...`

Lists the directory tree recursively under the provided logical `path`.

- `path` is optional. Empty path (`""`) lists the content root.

Example:

```bash
curl "http://localhost:3001/api/tree?path=notes"
```

### `GET /api/file?path=...` (or `?id=...`)

Reads a markdown file.

- Address the note by `path` (logical path under `CONTENT_ROOT`) or by `id`
  (frontmatter `id:`, when present). Only `.md` files are supported.
- Path must resolve under `CONTENT_ROOT`.

Example:

```bash
curl "http://localhost:3001/api/file?path=notes/todo.md"
curl "http://localhost:3001/api/file?id=2f3a-stable"   # alternative
```

Response includes:

- `content`
- `lastModified`
- `etag` (for optimistic concurrency)
- `id` — the note's stable id from frontmatter, when one is present

### `PUT /api/file`

Updates an existing markdown file.

Request body schema:

```json
{
  "path": "notes/todo.md",
  "content": "# updated",
  "etag": "optional-current-etag",
  "lastModified": "optional-current-lastModified"
}
```

Optimistic concurrency:

- If `etag` is supplied and does not match current file `etag`, request fails with `409 stale_write`.
- If `lastModified` is supplied and does not match current file `lastModified`, request fails with `409 stale_write`.

Example:

```bash
curl -X PUT "http://localhost:3001/api/file" \
  -H "Content-Type: application/json" \
  -d '{"path":"notes/todo.md","content":"# Updated","etag":"abc123"}'
```

### `PATCH /api/file`

Applies a granular edit to an existing markdown file without rewriting the
whole note. Designed for agents that want to add a task, prepend a status
block, or rewrite one section.

Request body schema:

```json
{
  "path": "notes/todo.md",
  "op": { "type": "append", "text": "- buy milk" },
  "etag": "optional-current-etag",
  "lastModified": "optional-current-lastModified",
  "idempotencyKey": "optional-string",
  "dryRun": false
}
```

Address the note by `path` OR by `id` (frontmatter `id:`). Supported `op`
shapes:

- `{ "type": "append", "text": "..." }` — append `text` to the end of the note.
- `{ "type": "prepend", "text": "..." }` — insert `text` at the top, AFTER any
  YAML frontmatter block so metadata stays at the top of the note.
- `{ "type": "replace_section", "heading": "## Tasks", "body": "..." }` —
  replace the body under the first heading matching `heading` exactly, up to
  the next sibling-or-higher heading (or EOF). The heading line itself is
  preserved. Returns `404 not_found` when the heading is not present.
- `{ "type": "replace_block", "blockId": "claim-1", "body": "..." }` —
  replace the block (paragraph / list-item / heading section) carrying the
  `^block-id` anchor. The anchor is re-attached to the replacement so future
  reads can still address the block. Returns `404 not_found` when no anchor
  with that id exists.
- `{ "type": "ensure_id", "id": "optional-uuid" }` — ensure the note has a
  stable `id:` in its frontmatter. If `id` is omitted, a fresh UUID is
  generated. Idempotent: a second call returns the existing id without
  rewriting the file or recording a new audit entry.

Optimistic concurrency mirrors `PUT /api/file`: pass `etag` (or
`lastModified`) to refuse the patch if the file changed under you (`409
stale_write`).

Idempotency: pass `idempotencyKey` so a retried request (e.g. after a network
blip) is a no-op — the original response is replayed without writing again
or recording a second audit entry. Keys are held in memory and reset on API
restart.

Dry run: pass `"dryRun": true` to receive the resulting content without
writing the file or recording an audit entry. The response sets
`dryRun: true`; its `etag` / `lastModified` describe the current (unchanged)
file, while `content` is the would-be result.

Example:

```bash
curl -X PATCH "http://localhost:3001/api/file" \
  -H "Content-Type: application/json" \
  -H "X-Actor: agent:mcp" \
  -d '{"path":"notes/todo.md","op":{"type":"append","text":"- buy milk"}}'
```

### `POST /api/file`

Creates a new markdown file.

Request body schema:

```json
{
  "path": "notes/new-page.md",
  "content": "# New Page"
}
```

Example:

```bash
curl -X POST "http://localhost:3001/api/file" \
  -H "Content-Type: application/json" \
  -d '{"path":"notes/new-page.md","content":"# New Page"}'
```

### `POST /api/dir`

Creates a directory (recursive mkdir).

Request body schema:

```json
{
  "path": "notes/projects"
}
```

Example:

```bash
curl -X POST "http://localhost:3001/api/dir" \
  -H "Content-Type: application/json" \
  -d '{"path":"notes/projects"}'
```

### `PATCH /api/path`

Moves/renames a path.

Request body schema:

```json
{
  "fromPath": "notes/old.md",
  "toPath": "notes/archive/old.md"
}
```

Supports directories and markdown files.

Example:

```bash
curl -X PATCH "http://localhost:3001/api/path" \
  -H "Content-Type: application/json" \
  -d '{"fromPath":"notes/old.md","toPath":"notes/archive/old.md"}'
```

### `DELETE /api/path?path=...&recursive=...`

Deletes a markdown file or directory.

- `path` (required): file or directory path.
- `recursive` (optional): `true`/`1` to recursively delete non-empty directories.

Example:

```bash
curl -X DELETE "http://localhost:3001/api/path?path=notes/archive&recursive=true"
```

### `GET /api/backlinks?path=...`

Lists notes that link to `path` via `[[wikilinks]]`. Returns `Backlink[]`
(`{ path, name, type? }`). When the link carried a typed relation
(`[[Target|rel:supports]]`), the backlink includes `type: "supports"`.

### `GET /api/block?path=...&block=<id>` (or `?id=<note-id>&block=<id>`)

Reads a single block (paragraph / list-item / heading section) carrying the
`^block-id` anchor, plus a few lines of surrounding context. Address the note
by `path` or by stable `id`. Returns `404 not_found` when the anchor is not
present.

```json
{
  "path": "notes/idea.md",
  "blockId": "claim-1",
  "startLine": 5,
  "endLine": 5,
  "text": "A claim worth citing.",
  "context": "Intro paragraph.\nA claim worth citing.\nClosing note.",
  "etag": "abc123",
  "lastModified": "2026-06-02T..."
}
```

### `GET /api/block-anchors?path=...` (or `?id=<note-id>`)

Lists every `^block-id` anchor in a note (id, 1-based line, line text). Useful
for an agent to discover stable addresses before patching by block.

### `GET /api/search?q=...&tag=...&limit=...`

Full-text and/or tag search across note bodies. At least one of `q` or `tag`
is required. Returns `SearchMatch[]` (`{ path, name, score, snippet, line, tags }`)
sorted by score.

```bash
curl "http://localhost:3001/api/search?q=roadmap"
curl "http://localhost:3001/api/search?tag=project"
```

### `GET /api/semantic-search?q=...&limit=...`

Relevance-ranked retrieval. Chunks every note (frontmatter stripped) and ranks
the chunks against `q` by TF-IDF cosine similarity, so it surfaces passages
that are topically about the query rather than exact substring matches. `q` is
required. Returns `SemanticHit[]` (`{ path, heading?, snippet, score, chunkIndex }`)
sorted by score. Runs locally with no API key.

```bash
curl "http://localhost:3001/api/semantic-search?q=how%20do%20backups%20work"
```

### `GET /api/audit?path=...&limit=...`

Returns the provenance/audit trail (`AuditEntry[]`, newest first), optionally
filtered to a single `path`.

### `GET /api/events`

A [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
stream (`Content-Type: text/event-stream`) of live vault changes, so a client
(the web UI) reflects what an agent — or another process — does the instant it
happens, without polling. Each change is sent as a single frame:

```
data: {"type":"created","path":"notes/idea.md","actor":"agent:mcp","ts":"2026-06-03T...","source":"api"}
```

The payload is a `VaultEvent` (from `@repo/shared`):

- `type` — `created` | `updated` | `moved` | `deleted` | `dir_created` |
  `proposal_created` | `proposal_resolved`.
- `path` — logical path affected (source path for moves).
- `toPath` — destination path, for `moved` events.
- `actor` — who caused it (`human`, `agent:mcp`, …); `external` for out-of-band
  edits picked up by the watcher.
- `ts` — ISO timestamp.
- `source` — `api` (published by a route handler alongside its audit write) or
  `watch` (published by the filesystem watcher for edits that never went through
  the API: a direct file edit, `git`, another process).

Implementation notes:

- Events come from an in-process `EventBus`. Every mutating handler publishes to
  it right where it records the audit entry, so the stream and the audit log
  never diverge.
- A filesystem watcher (`fs.watch`, recursive) covers out-of-band edits. It
  ignores the hidden `.fsbrain/` dir and non-`.md` churn, and de-dupes against
  API-originated writes so a single change does not double-fire.
- The stream sends periodic heartbeat comments to keep the connection alive and
  cleans up on client disconnect. The route is never buffered or compressed.
- No CORS headers are set, matching the rest of the API. The web client reaches
  it same-origin via the Vite dev proxy; a cross-origin deployment would need
  CORS (and, like the rest of the API, auth — out of scope for this local,
  single-user tool).

```bash
curl -N "http://localhost:3001/api/events"
```

### Edit proposals (review queue)

Lets agents suggest changes a human approves before they touch the vault.

- `POST /api/proposals` — create a proposal. Body: `{ action: "create"|"update"|"delete",
path, content?, baseEtag?, note? }`. `content` is required for create/update;
  `baseEtag` (from a prior read) makes a stale `update` fail on approval. The
  proposer is the `X-Actor` header. Returns the `EditProposal` (status `pending`).
- `GET /api/proposals?status=pending|approved|rejected` — list proposals (newest first).
- `POST /api/proposals/resolve` — body `{ id, decision: "approve"|"reject" }`. Approving
  applies the edit (recorded in the audit log as the **proposing** actor) and marks the
  proposal `approved`; rejecting discards it. Both destructive actions (`update`,
  `delete`) honor `baseEtag` and return `409 stale_write` if the file changed since the
  proposal was made. **Resolution is the human's action**; the resolver is taken from
  `X-Actor` (default `human`) and requests with an `agent:` actor are rejected `403`.
  This is convention-level (`X-Actor` is unauthenticated, so it is not airtight — the
  MCP server also omits a resolve tool); true enforcement needs authn/z. Proposals are
  stored under `CONTENT_ROOT/.fsbrain/proposals/`.

```bash
# Agent proposes an edit
curl -X POST "http://localhost:3001/api/proposals" \
  -H "Content-Type: application/json" -H "X-Actor: agent:mcp" \
  -d '{"action":"update","path":"notes/todo.md","content":"# Updated by agent","note":"tidy up"}'

# Human approves it
curl -X POST "http://localhost:3001/api/proposals/resolve" \
  -H "Content-Type: application/json" \
  -d '{"id":"<proposal-id>","decision":"approve"}'
```

## Provenance: the `X-Actor` header

Mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`) may send an `X-Actor` header
identifying who is making the change (e.g. `human`, `agent:mcp`). It defaults to
`human`. Each successful mutation is appended to an append-only audit log at
`CONTENT_ROOT/.fsbrain/audit.jsonl` and surfaced via `GET /api/audit` and the
web **Activity** tab.

```bash
curl -X POST "http://localhost:3001/api/file" \
  -H "Content-Type: application/json" \
  -H "X-Actor: agent:mcp" \
  -d '{"path":"notes/from-agent.md","content":"# Written by an agent"}'
```

## Error model

All failures use this shape:

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "\"path\" must be a string"
  }
}
```

Standard error codes:

- `invalid_path`: path traversal/absolute path/not-allowed extension.
- `not_found`: missing file or directory.
- `validation_error`: invalid JSON schema/field type/empty value.
- `io_error`: unexpected filesystem errors.
- `conflict`: path already exists or destination conflicts.
- `stale_write`: optimistic concurrency check failed.
- `bad_request`: malformed request body or unsupported shape.
