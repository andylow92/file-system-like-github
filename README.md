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
