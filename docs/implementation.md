# Implementation Status

> **Audience: AI agents (and humans) working on this repo.**
> This is the source of truth for _where we are_ and _what's next_.
> Keep it accurate: update the status tables when you finish a unit of work.
> Routed from [`AGENTS.md`](../AGENTS.md).

_Last updated: 2026-06-02_

---

## 1. Vision

A **local-first markdown workspace** that doubles as a **shared brain**:

- **For humans** — navigate like a GitHub repo, edit like a modern docs tool,
  with files stored as plain `.md` (never locked in a database).
- **For agents** — a machine-readable substrate agents can read, search, link,
  and write, where **every agent action stays visible to the human**.

We are closing two gaps in parallel: _Obsidian-for-humans_ (linking, search,
real rendering) and _agent-brain_ (machine API, retrieval, provenance).

---

## 2. Architecture map

```
apps/web (React + Vite)          apps/api (Node HTTP)           packages/shared
  GlobalLayout / FileTreeSidebar   /api/tree   list dir tree      FileNode, Api* contracts
  FileViewerTabs (Preview|Edit)    /api/file   read/create/update markdown.ts (pure utils)
  MarkdownPreviewPane (renderer)   /api/dir    create folder
  RichTextEditorPane               /api/path   move / delete
  api/files.ts (HTTP client)       /api/backlinks  link graph
  openrouter/ (Fix Format)         storage/ (FileRepository, PathResolver)
```

Key facts an agent must know:

- **Storage is sandboxed** to `CONTENT_ROOT`. `PathResolver` rejects traversal
  and absolute paths. Do not weaken this.
- **`@repo/shared` is consumed as source** (`main: src/index.ts`); it has no
  test runner — put its unit tests in `apps/api` (node vitest).
- **Optimistic concurrency** already exists on writes via `etag` + `lastModified`
  (see `handlePutFile`). Reuse it for any new write path.
- API relative imports use explicit `.js` extensions (ESM). Match that style.

---

## 3. Current capabilities (grounded in code)

| Capability                                  | Status | Notes                                                     |
| ------------------------------------------- | :----: | --------------------------------------------------------- |
| GitHub-style file tree + folders-first sort |   ✅   | `FileTreeSidebar`, `GlobalLayout`                         |
| Create / rename / move / delete (md + dirs) |   ✅   | `/api/file`, `/api/dir`, `/api/path`                      |
| Read / update with optimistic concurrency   |   ✅   | `etag` / `lastModified` in `handlePutFile`                |
| Edit ↔ Preview tabs                         |   ✅   | `FileViewerTabs`; hard toggle (not live WYSIWYG)          |
| Path sandboxing inside `CONTENT_ROOT`       |   ✅   | `PathResolver`                                            |
| Sidebar filter by **filename**              |   ✅   | `filterQuery` — name/path only, not file contents         |
| "Fix Format" via OpenRouter                 |   ✅   | Client-side only (`openrouter/`); no agent-facing surface |
| `[[wikilinks]]` (clickable) + resolution    |   🚧   | Slice 1 — see §5                                          |
| Backlinks panel                             |   🚧   | Slice 1 — `/api/backlinks`                                |
| Frontmatter + `#tags` parsing               |   🚧   | Slice 1 — `@repo/shared` `markdown.ts`                    |

Legend: ✅ done · 🚧 in progress · ⬜ not started

---

## 4. Known gaps (the backlog, prioritized)

### For humans (vs Obsidian)

| Gap                                                 | Priority | Status |
| --------------------------------------------------- | :------: | :----: |
| `[[wikilinks]]`, backlinks, link graph              |    P0    |   🚧   |
| Real CommonMark/GFM renderer (tables, images, task  |    P0    |   ⬜   |
| lists, h3–h6, links, code highlight, math, mermaid) |          |        |
| Full-text **content** search + quick switcher       |    P1    |   ⬜   |
| Frontmatter / tags / properties                     |    P1    |   🚧   |
| Non-markdown attachments (images, PDFs, canvas)     |    P2    |   ⬜   |
| Command palette, tabs/splits, outline, daily notes  |    P2    |   ⬜   |
| Version history / trash / Git sync                  |    P2    |   ⬜   |
| Plugin system, themes, mobile, multi-device sync    |    P3    |   ⬜   |

### For agents (the brain)

| Gap                                                       | Priority | Status |
| --------------------------------------------------------- | :------: | :----: |
| Machine-facing API / **MCP server** over `FileRepository` |    P0    |   ⬜   |
| Semantic retrieval (chunking + embeddings + hybrid)       |    P1    |   ⬜   |
| Structured knowledge (note IDs, block anchors `^id`,      |    P1    |   🚧   |
| typed link graph)                                         |          |        |
| Section/append/patch writes + idempotency + dry-run       |    P1    |   ⬜   |
| **Provenance**: per-change attribution, audit feed,       |    P0    |   ⬜   |
| agent-edit review/approval queue                          |          |        |
| Live state (SSE/WebSocket + file watcher)                 |    P2    |   ⬜   |
| Context-bundle retrieval endpoint (token-budgeted)        |    P2    |   ⬜   |
| Auth, per-agent scopes, path-level permissions            |    P2    |   ⬜   |

---

## 5. Roadmap (sequenced slices)

Each slice is a vertical, demoable increment. Build in order — each unlocks the
next.

1. **Slice 1 — Links & metadata foundation** 🚧 _(current)_
   - `@repo/shared/markdown.ts`: pure functions for frontmatter, `#tags`, and
     `[[wikilink]]` extraction + resolution. Unit-tested in `apps/api`.
   - `GET /api/backlinks?path=`: reverse link index across the vault.
   - Preview renders `[[wikilinks]]` as clickable links; backlinks panel under
     the preview.
   - **Success:** wikilinks navigate, backlinks list the linking notes,
     frontmatter/tags parse correctly, tests + lint + build green.
2. **Slice 2 — Real renderer.** Replace the hand-rolled parser with
   `remark`/`rehype` (tables, images, task lists, links, code highlight). Keeps
   wikilink/tag plugins from Slice 1.
3. **Slice 3 — Full-text + tag search.** Content search endpoint + quick
   switcher UI; surfaces "linked / unlinked mentions".
4. **Slice 4 — MCP server.** Wrap `FileRepository` as MCP tools
   (`list/read/write/search/backlinks`) with section-level patch + existing etag
   concurrency. Agents become first-class.
5. **Slice 5 — Semantic search.** Chunking + embeddings + hybrid retrieval; a
   token-budgeted context-bundle endpoint for RAG.
6. **Slice 6 — Provenance + live layer.** Change attribution (human vs which
   agent/model), audit feed, agent-edit review queue, and SSE/file-watcher so
   the human's view updates live. This closes the trust loop.

Slices 1–3 close the Obsidian-for-humans gap; 4–6 build what Obsidian lacks: a
vault that is natively an agent's brain _and_ auditable by the human.

---

## 6. Conventions for contributors (human or agent)

- **Read [`AGENTS.md`](../AGENTS.md) first.** Follow the Operating Rules and
  Claude Code Rules there.
- Keep changes **surgical**; match the file's existing style.
- Preserve the **path-sandboxing** and **markdown-only** safety guarantees.
- Add tests next to the code they cover (`*.test.ts(x)`); shared utils →
  `apps/api`.
- Verify with project commands (§7). Do not invent commands.
- **Update this file** when a slice's status changes.

---

## 7. Commands

```bash
npm install        # install workspaces
npm run dev:api    # API   → http://localhost:3001
npm run dev:web    # web   → http://localhost:5173
npm test           # all workspace tests (vitest)
npm run lint       # eslint
npm run build      # tsc/vite build across workspaces
```
