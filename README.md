# Monorepo: Web + API + Shared

This repository is a TypeScript monorepo for a markdown-file workspace with a React frontend and Node backend.

## Quick Start

1. **Prerequisites**
   - Node.js 22.x and npm 10.x (the repo does not pin `engines`, so use these recommended versions).
2. **Install dependencies**
   - `npm install`
3. **Start development servers (two terminals)**
   - Terminal 1: `npm run dev:api`
   - Terminal 2: `npm run dev:web`
4. **Verify both services are up**
   - API health endpoint: `http://localhost:3001/health`
   - Web dev URL: `http://localhost:5173`
5. **Expected result**
   - The health URL returns a success JSON response, and the web URL loads the markdown workspace UI.

## Architecture

### Textual architecture diagram

```txt
+-------------------------+        HTTP/JSON        +-------------------------+
| apps/web (React + Vite) | <---------------------> | apps/api (Node HTTP)    |
| - file tree UI           |                         | - path validation        |
| - preview/edit tabs      |                         | - markdown file CRUD     |
| - save interactions      |                         | - tree generation        |
+-------------------------+                         +-------------------------+
              ^                                                 |
              | imports shared contracts                        | reads/writes
              |                                                 v
        +------------------------------+              +-------------------------+
        | packages/shared              |              | CONTENT_ROOT directory  |
        | - FileNode/FileContent types |              | host filesystem storage |
        | - API response envelopes     |              +-------------------------+
        +------------------------------+
```

## Repository layout

```txt
apps/
  api/      # Backend server + filesystem storage layer
  web/      # Frontend UI and component tests
packages/
  shared/   # Shared TypeScript contracts
docs/
  integration-test-plan.md
```

## Environment variables

Backend (`apps/api`) supports:

- `CONTENT_ROOT`: base directory where markdown files/directories are read and written.
  - Recommended in local/dev/production so data location is explicit.
  - If unset, backend defaults to `<repo>/content`.
- `PORT`: API server port.
  - Defaults to `3001`.

## Local run commands

1. Install dependencies:

```bash
npm install
```

2. Start backend:

```bash
npm run dev:api
```

3. Start frontend in a separate terminal:

```bash
npm run dev:web
```

4. Confirm API health responds **before** testing UI actions:

```bash
curl -sf http://localhost:3001/health
```

5. Run tests:

```bash
npm test
```

6. Lint + format checks:

```bash
npm run lint
npm run format
```

## Security notes (filesystem access)

- Filesystem access is intentionally isolated to `apps/api` storage modules.
- Path resolution normalizes logical paths and rejects traversal or absolute path usage.
- Markdown-specific operations enforce `.md` extension checks.
- Backend operations should always resolve and verify paths remain inside `CONTENT_ROOT`.
- Avoid exposing raw absolute host paths to client responses.

## Deployment notes (persistent storage)

To keep markdown files/directories across restarts, mount a persistent host volume and pass it as `CONTENT_ROOT`.

### Docker example

```bash
docker run \
  -p 3001:3001 \
  -e CONTENT_ROOT=/data/content \
  -v /srv/markdown-content:/data/content \
  your-api-image
```

### docker-compose example

```yaml
services:
  api:
    image: your-api-image
    ports:
      - '3001:3001'
    environment:
      CONTENT_ROOT: /data/content
    volumes:
      - /srv/markdown-content:/data/content
```

Use the manual integration checklist in `docs/integration-test-plan.md` during release validation.

## Documentation

- [`apps/api/README.md`](apps/api/README.md) — Start here for backend endpoint coverage and detailed request/response behavior.
- [`docs/integration-test-plan.md`](docs/integration-test-plan.md) — Open this next for manual release validation and end-to-end verification steps.
- `apps/web/` frontend docs — No frontend-specific Markdown docs are currently present under `apps/web/`; this README and in-code component tests are the current references.

## Troubleshooting

- **Symptom:** `curl -sf http://localhost:3001/health` fails or exits non-zero. **Likely cause:** the API process is not running, crashed on startup, or is bound to a different `PORT`. **Corrective action:** restart the backend (`npm run dev:api`) and verify startup logs show it listening on `http://localhost:3001` (or update the curl URL to the configured port).
- **Symptom:** the frontend loads, but file/tree requests fail in the browser or show network/CORS-style errors. **Likely cause:** the web app is calling the wrong API base URL (commonly a port mismatch such as `3000` vs `3001`, or an incorrect env/base-URL setting). **Corrective action:** check the frontend API base URL/env configuration and point it to the running backend origin (default `http://localhost:3001`), then restart the web dev server.
- **Symptom:** tree responses are empty or file reads return "not found" even though content exists on disk. **Likely cause:** `CONTENT_ROOT` points to the wrong directory (or an unexpected default path is being used). **Corrective action:** set `CONTENT_ROOT` explicitly to the intended content directory and restart the API.
- **Symptom:** API requests fail with permission-denied errors when listing, reading, or saving files. **Likely cause:** the mounted/host content directory does not grant read/write access to the API process user. **Corrective action:** fix directory ownership/permissions on the mounted path (and container bind mount, if used) so the API process can read and write under `CONTENT_ROOT`.
- **Symptom:** creating/saving some files is rejected while directory operations still work. **Likely cause:** file endpoints enforce markdown-only behavior and reject non-`.md` file paths. **Corrective action:** use `.md` filenames for file CRUD requests (or rename existing targets to `.md`) to match API validation rules.
