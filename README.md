# File-System-Like GitHub for Markdown

> A fast, local-first markdown workspace that feels like **GitHub’s file tree** and **Notion-style editing**—built for docs, notes, wikis, and knowledge bases.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=000)](#)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](#)
[![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white)](#)

If you’ve ever wanted your markdown content to be:

- **easy to navigate** like a repo,
- **easy to edit** like a modern docs tool,
- and **stored as real files** (not locked in a database),

this project is for you.

---

## Why this project exists

Most note/documentation tools force a tradeoff:

- Great UX, but proprietary storage.
- Great storage (plain files), but clunky UX.

This repo bridges both worlds:

- ✅ Familiar tree-based navigation
- ✅ Markdown-first editing and preview
- ✅ Safe filesystem-backed API
- ✅ Monorepo structure for easy extension

---

## What you can do with it

- Browse markdown content in a GitHub-like file tree
- Open files and switch between **Preview** and **Edit** tabs
- Create files and folders
- Rename or move files/folders
- Delete files/folders
- Save with optimistic concurrency metadata (`etag` / `lastModified`)
- Keep your content under a configurable `CONTENT_ROOT`

---

## Built for real-world use cases

- Personal knowledge management (PKM)
- Team docs portals
- Internal runbooks/playbooks
- Product/project documentation
- Lightweight markdown CMS foundations

---

## Architecture at a glance

```txt
apps/web (React + Vite)
   ├─ File tree + editor/preview UI
   └─ Calls API over HTTP/JSON

apps/api (Node HTTP server)
   ├─ Validates and resolves logical paths
   ├─ Performs markdown-focused file CRUD
   └─ Enforces safe access inside CONTENT_ROOT

packages/shared
   └─ Shared TypeScript contracts and response shapes
```

Repository structure:

```txt
apps/
  api/      # Backend server + filesystem storage
  web/      # Frontend UI
packages/
  shared/   # Shared types/contracts
docs/
  integration-test-plan.md
```

---

## Quick start (under 5 minutes)

### 1) Prerequisites

- Node.js **22.x**
- npm **10.x**

### 2) Install

```bash
npm install
```

### 3) Run API + Web (two terminals)

Terminal A:

```bash
npm run dev:api
```

Terminal B:

```bash
npm run dev:web
```

### 4) Open the app

- Web UI: `http://localhost:5173`
- API health: `http://localhost:3001/health`

---

## Environment variables

For `apps/api`:

- `CONTENT_ROOT`
  - Base directory for markdown files/directories.
  - If unset, defaults to `<repo>/content`.
- `PORT`
  - API server port (default: `3001`).

Example:

```bash
CONTENT_ROOT=/absolute/path/to/content PORT=3001 npm run dev:api
```

---

## API snapshot

- `GET /health`
- `GET /api/tree?path=...`
- `GET /api/file?path=...`
- `POST /api/file`
- `PUT /api/file`
- `POST /api/dir`
- `PATCH /api/path`
- `DELETE /api/path?path=...&recursive=true|false`

For endpoint details and request/response examples, see [`apps/api/README.md`](apps/api/README.md).

---

## Local quality checks

```bash
npm test
npm run lint
npm run format
```

---

## Security model (important)

- API path handling rejects traversal and absolute paths.
- File operations are markdown-focused (`.md`).
- Storage resolution ensures requests remain within `CONTENT_ROOT`.

This helps protect the host filesystem while still enabling file-based workflows.

---

## Deployment note

For persistent content in production, mount a host volume and point `CONTENT_ROOT` to it.

See the full deployment examples in this README’s history and backend docs.

---

## Roadmap ideas

- Search across markdown files
- Git sync workflows
- Multi-user auth + permissions
- Real-time collaborative editing
- Pluggable storage adapters

---

## Contributing

PRs are welcome. If you want to contribute:

1. Open an issue with the use case/problem statement.
2. Submit a focused PR with tests.
3. Keep markdown/file safety guarantees intact.

---

## Extra docs

- Backend API details: [`apps/api/README.md`](apps/api/README.md)
- Manual integration validation: [`docs/integration-test-plan.md`](docs/integration-test-plan.md)

---

## SEO-friendly keywords (for discoverability)

markdown workspace, github-like file tree, notion-style markdown editor, filesystem CMS, markdown knowledge base, react markdown editor, node filesystem api
