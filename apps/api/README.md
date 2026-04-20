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

### `GET /api/file?path=...`
Reads a markdown file.

- Requires query param `path`.
- Path must resolve under `CONTENT_ROOT`.
- Only `.md` files are supported.

Example:

```bash
curl "http://localhost:3001/api/file?path=notes/todo.md"
```

Response includes:
- `content`
- `lastModified`
- `etag` (for optimistic concurrency)

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
