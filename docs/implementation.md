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
apps/web (React + Vite)          apps/api (Node HTTP)             packages/shared
  GlobalLayout / FileTreeSidebar   /api/tree     list dir tree      FileNode, Api* contracts
  FileViewerTabs (Prev|Edit|Split| /api/file     read/create/update markdown.ts (links/tags)
    Activity|Review)               /api/dir      create folder      search.ts  (text match)
  MarkdownPreviewPane (react-      /api/path     move / delete      semantic.ts (TF-IDF)
    markdown: GFM/math/highlight   /api/backlinks        link graph   markdown/remarkWikilinks.ts
    + wikilinks)                   /api/search           full-text    Audit/Search/Proposal types
  BacklinksPanel / ActivityPanel   /api/semantic-search  ranked retrieval
  SearchDialog (Text|Semantic)     /api/audit            provenance feed
  ReviewPanel (proposals)          /api/proposals[/resolve]  edit review queue
  api/files.ts (HTTP client)       storage/ (FileRepository, PathResolver,
  openrouter/ (Fix Format)                   AuditLog, ProposalStore)

apps/mcp (MCP stdio server, 13 tools) — proxies the HTTP API: list/read/create/
  update/search/semantic_search/backlinks/recent_activity/move/delete plus
  propose_edit + list_proposals. Writes carry X-Actor: agent:mcp, so they land
  in the human Activity feed; proposals await human approval in the Review tab.
```

Key facts an agent must know:

- **Storage is sandboxed** to `CONTENT_ROOT`. `PathResolver` rejects traversal
  and absolute paths. Do not weaken this.
- **Hidden dotfiles/dirs are excluded** from the tree. The audit log lives in
  `CONTENT_ROOT/.fsbrain/audit.jsonl`.
- **`@repo/shared` is consumed as source** (`main: src/index.ts`); it has no
  test runner — put its unit tests in `apps/api` (node vitest).
- **Optimistic concurrency** exists on writes via `etag` + `lastModified`
  (see `handlePutFile`). Reuse it for any new write path.
- **Provenance:** mutations read the `X-Actor` header (default `human`) and
  append an `AuditEntry`. Keep new write paths recording audit.
- API/MCP relative imports use explicit `.js` extensions (NodeNext). Match that.
  `npm run build` is green across all workspaces — keep it that way.

---

## 3. Current capabilities (grounded in code)

| Capability                                  | Status | Notes                                                |
| ------------------------------------------- | :----: | ---------------------------------------------------- |
| GitHub-style file tree + folders-first sort |   ✅   | `FileTreeSidebar`, `GlobalLayout`                    |
| Create / rename / move / delete (md + dirs) |   ✅   | `/api/file`, `/api/dir`, `/api/path`                 |
| Read / update with optimistic concurrency   |   ✅   | `etag` / `lastModified` in `handlePutFile`           |
| Edit ↔ Preview tabs                         |   ✅   | `FileViewerTabs`; hard toggle (not live WYSIWYG)     |
| Path sandboxing inside `CONTENT_ROOT`       |   ✅   | `PathResolver`                                       |
| Sidebar filter by **filename**              |   ✅   | `filterQuery` — name/path only, not file contents    |
| "Fix Format" via OpenRouter                 |   ✅   | Client-side only (`openrouter/`)                     |
| `[[wikilinks]]` (clickable) + resolution    |   ✅   | `markdown.ts`, `remarkWikilinks`                     |
| Backlinks panel                             |   ✅   | `/api/backlinks`, `BacklinksPanel`                   |
| Frontmatter + `#tags` parsing               |   ✅   | `@repo/shared` `markdown.ts`; chips in preview       |
| Rich renderer (GFM, math, highlight)        |   ✅   | `react-markdown` + remark-gfm/math, rehype-katex     |
| Full-text + tag search (Ctrl/Cmd-K)         |   ✅   | `/api/search`, `SearchDialog`                        |
| Semantic (relevance) search                 |   ✅   | `/api/semantic-search`, `semantic.ts` (TF-IDF)       |
| Provenance / audit feed (Activity tab)      |   ✅   | `X-Actor`, `AuditLog`, `/api/audit`, `ActivityPanel` |
| Agent-edit review/approval queue            |   ✅   | `/api/proposals`, `ProposalStore`, `ReviewPanel`     |
| **MCP server** (agent tools)                |   ✅   | `apps/mcp` (13 tools) — proxies API as `agent:mcp`   |
| `npm run build` green (all workspaces)      |   ✅   | NodeNext `.js` imports + shared `rootDir`            |

Legend: ✅ done · 🚧 in progress · ⬜ not started

---

## 4. Known gaps (the backlog, prioritized)

### For humans (vs Obsidian)

| Gap                                                | Priority | Status |
| -------------------------------------------------- | :------: | :----: |
| `[[wikilinks]]`, backlinks, link graph             |    P0    |  ✅\*  |
| Real CommonMark/GFM renderer (tables, images, task |    P0    |  ✅†   |
| lists, h3–h6, links, code highlight, math)         |          |        |
| Full-text **content** search + quick switcher      |    P1    |   ✅   |
| Frontmatter / tags / properties                    |    P1    |   ✅   |
| Non-markdown attachments (images, PDFs, canvas)    |    P2    |   ⬜   |
| Command palette, tabs/splits, outline, daily notes |    P2    |   ◑    |
| Version history / trash / Git sync                 |    P2    |   ⬜   |
| Plugin system, themes, mobile, multi-device sync   |    P3    |   ⬜   |

\* link graph exists as backlinks; a visual graph view is still open. ◑ = quick
switcher + split done; palette/outline/daily-notes open. † renderer shipped and
lazy-loaded; Mermaid diagrams are the remaining follow-up (see roadmap).

### For agents (the brain)

| Gap                                                  | Priority | Status |
| ---------------------------------------------------- | :------: | :----: |
| Machine-facing API / **MCP server** over the vault   |    P0    |   ✅   |
| **Provenance**: per-change attribution + audit feed  |    P0    |   ✅   |
| agent-edit review/approval queue                     |    P1    |   ✅   |
| Semantic retrieval (chunking + ranking; embeddings)  |    P1    |  ✅‡   |
| Structured knowledge (note IDs, block anchors `^id`, |    P1    |   ◑    |
| typed link graph)                                    |          |        |
| Section/append/patch writes + idempotency + dry-run  |    P1    |   ⬜   |
| Live state (SSE/WebSocket + file watcher)            |    P2    |   ⬜   |
| Context-bundle retrieval endpoint (token-budgeted)   |    P2    |   ⬜   |
| Auth, per-agent scopes, path-level permissions       |    P2    |   ⬜   |

‡ chunking + TF-IDF cosine ranking shipped (`semantic.ts`, no API key, runs
offline); swapping in real vector embeddings via a provider is the follow-up.
◑ = wikilink graph + tags exist; note IDs / block anchors still open. The
audit feed records attribution; an explicit human review/approval queue for
agent edits is the natural next provenance step.

---

## 5. Roadmap (sequenced slices)

Each slice is a vertical, demoable increment. Build in order — each unlocks the
next.

1. **Slice 1 — Links & metadata foundation.** ✅ Done.
   `markdown.ts` (frontmatter, `#tags`, `[[wikilink]]` parse + resolve),
   `GET /api/backlinks`, clickable wikilinks, backlinks panel.
2. **Slice 3 — Full-text + tag search.** ✅ Done.
   `GET /api/search` (text + tag), `search.ts` helper, Ctrl/Cmd-K `SearchDialog`
   (prefix `#` for tag search).
3. **Slice 4 — MCP server.** ✅ Done.
   `apps/mcp` stdio server proxying the HTTP API (now 13 tools); writes carry
   `X-Actor: agent:mcp` and flow through the audit trail.
4. **Slice 6a — Provenance.** ✅ Done.
   `X-Actor` attribution, append-only `AuditLog` (`.fsbrain/audit.jsonl`),
   `GET /api/audit`, and the human-facing **Activity** tab.
5. **Slice 2 — Real renderer.** ✅ Done.
   `MarkdownPreviewPane` uses `react-markdown` + `remark-gfm` (tables, task
   lists, strikethrough, autolinks, h3–h6), `remark-math` + `rehype-katex`
   (math), and highlight.js for fenced code (keeping the copy button). The
   `remarkWikilinks` plugin preserves `[[wikilinks]]`; frontmatter is stripped
   and tags render as chips. The pane is lazy-loaded (`React.lazy`), so the main
   bundle stays ~63 kB gzip and the renderer (~186 kB gzip) loads on demand.
6. **Slice 5 — Semantic search.** ✅ Done (local).
   `semantic.ts` chunks notes and ranks them by TF-IDF cosine similarity;
   `GET /api/semantic-search`, a Text|Semantic toggle in `SearchDialog`, and a
   `semantic_search` MCP tool. Runs offline, no API key. A real embedding
   provider can replace the ranking engine without changing callers.
7. **Slice 6b — Agent-edit review queue.** ✅ Done.
   Agents `propose_edit` (`POST /api/proposals`) create/update/delete edits;
   `ProposalStore` keeps them in `.fsbrain/proposals/`. A human reviews the diff
   in the **Review** tab and approves (applied + audited as the proposer) or
   rejects. Resolution is human-only. Closes the provenance trust loop.

### Next up (open)

8. **Embeddings + renderer follow-ups.** Swap the TF-IDF ranker for real vector
   embeddings (remote `/v1/embeddings` or on-device) with a token-budgeted
   context-bundle endpoint for RAG. Cache the chunk/IDF index instead of
   re-reading + re-ranking the whole vault per query (invalidate on writes via
   the existing mutation/audit paths). Add Mermaid diagrams to the renderer.
9. **Live layer.** SSE/WebSocket + file watcher so the human's view (and the
   Activity feed) updates the moment an agent writes.

Slices 1–4 + the renderer close most of the Obsidian-for-humans gap and build
what Obsidian lacks: a vault that is natively an agent's brain _and_ auditable
by the human.

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
