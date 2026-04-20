# Monorepo: Web + API + Shared

This repository is organized as a monorepo with separate frontend and backend applications and a shared TypeScript package.

## Architecture

- `apps/web`: React frontend with routing, a two-pane global layout, and tabbed content (`Preview` + `Edit`).
- `apps/api`: Node.js HTTP server with config loading (`CONTENT_ROOT`), health endpoint, and filesystem access confined to backend.
- `packages/shared`: Shared TypeScript interfaces and API envelope contracts consumed by both apps.

## Folder Layout

```txt
apps/
  web/
  api/
packages/
  shared/
```

## Local Run Instructions

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run backend:
   ```bash
   npm run dev:api
   ```
3. Run frontend (in a separate terminal):
   ```bash
   npm run dev:web
   ```

## Environment

Backend supports:

- `CONTENT_ROOT` (optional): absolute/relative path to base content directory on host machine.
  - If unset, backend defaults to `<repo>/content`.

## Notes

- Direct filesystem reads are intentionally isolated to `apps/api`.
- `apps/web` and `packages/shared` do not access Node filesystem APIs directly.
