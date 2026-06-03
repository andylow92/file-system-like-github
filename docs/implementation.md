# Implementation Status

> **Audience: AI agents (and humans) working on this repo.**
> This is the source of truth for _where we are_ and _what's next_.
> Keep it accurate: update the status tables when you finish a unit of work.
> Routed from [`AGENTS.md`](../AGENTS.md).

_Last updated: 2026-06-03 (live layer: SSE + file watcher)_

> **Latest change.** The web UI now reflects vault changes **the instant they
> happen**. An in-process `EventBus` (`apps/api/src/events/`) receives a
> `VaultEvent` from every mutating handler — published right beside the audit
> write so the stream and the audit log never diverge — and a recursive
> `fs.watch` watcher publishes `source:'watch'` events for out-of-band edits
> (a direct file edit, `git`, another process), ignoring `.fsbrain/` and
> non-`.md` churn and de-duping against API writes. `GET /api/events` streams
> these over Server-Sent Events; the web `useVaultEvents` hook subscribes and
> surgically refreshes the tree, the open file (preserving unsaved drafts —
> showing a non-destructive "changed on disk" prompt instead of clobbering),
> the Activity feed, and the Review badge, with a live/reconnecting indicator.
> The MCP server's embedded API starts the bus + watcher too, so an agent's
> writes surface to a watching human live.

> **Latest change.** The project is now **clone-and-run testable** for an
> agent. `npm run start:agent` launches the self-contained `fsbrain-mcp` —
> when `API_BASE_URL` is unset it starts the storage API in-process on
> `127.0.0.1` (ephemeral port), auto-creates `CONTENT_ROOT` (default
> `~/.fsbrain/vault`), seeds a `welcome.md` on an empty vault, prints a
> one-line readiness banner to stderr, and bundles to a runnable
> `dist/server.js` (npm bin `fsbrain-mcp`). Copy-paste host configs for
> OpenClaw / Claude Desktop / Claude Code / Cursor live in
> [`CONNECT.md`](CONNECT.md). The guarantee is enforced by an automated
> fresh-clone e2e test (`apps/mcp/src/__tests__/freshClone.test.ts`) that
> spawns the bin as a real stdio child against a temp vault, drives it via
> the MCP SDK client, and asserts writes land both on disk and in the audit
> log — runs in `npm test`.
>
> **Heads-up for existing local setups.** The default `CONTENT_ROOT` moved
> from `<cwd>/content` to `~/.fsbrain/vault`. Existing `./content` notes
> aren't deleted, but `npm run dev:api` / `dev:web` without `CONTENT_ROOT`
> set will now read the new path. Set `CONTENT_ROOT=./content` (e.g. in
> `apps/api/.env` or your shell) to keep the old location.

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
  FileViewerTabs (Prev|Edit|Split| /api/file     read/create/update markdown.ts (links/tags,
    Activity|Review)               /api/file PATCH  granular edits    typed `rel:` aliases)
  MarkdownPreviewPane (react-      /api/dir      create folder      patch.ts (append/prepend/
    markdown: GFM/math/highlight   /api/path     move / delete       replace_section/_block,
    + wikilinks + ^block-anchors)  /api/backlinks        link graph    ensure_id)
  BacklinksPanel / ActivityPanel   /api/block            block read blocks.ts (^id helpers)
  SearchDialog (Text|Semantic)     /api/block-anchors    list ^ids  noteId.ts (stable id)
  ReviewPanel (proposals)          /api/search           full-text  search.ts  (text match)
  api/files.ts (HTTP client)       /api/semantic-search  ranked     semantic.ts (TF-IDF)
  hooks/useVaultEvents (SSE)       /api/audit            provenance markdown/remarkWikilinks.ts
  openrouter/ (Fix Format)         /api/proposals[/resolve]  review queue VaultEvent contract
                                   /api/events     live SSE stream of VaultEvents
                                   storage/ (FileRepository, PathResolver,
                                              AuditLog, ProposalStore, IdempotencyCache)
                                   events/ (EventBus, fs.watch watcher, SSE handler)

apps/mcp (MCP stdio server, 16 tools) — exposes the vault to agents: list/read/
  create/update/patch/search/semantic_search/backlinks/recent_activity/move/delete
  plus read_block, get_block_anchors, propose_edit + list_proposals. When
  API_BASE_URL is unset, runs the storage API in-process on 127.0.0.1 (ephemeral
  port), auto-creates CONTENT_ROOT, and seeds a welcome.md on an empty vault, so
  an MCP host (OpenClaw, Claude Desktop, Claude Code, Cursor) can spawn it with
  one `node dist/server.js` (npm bin `fsbrain-mcp`). Writes carry X-Actor:
  agent:mcp (override via MCP_ACTOR) and land in the human Activity feed;
  proposals await human approval in the Review tab.
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

| Capability                                  | Status | Notes                                                                |
| ------------------------------------------- | :----: | -------------------------------------------------------------------- |
| GitHub-style file tree + folders-first sort |   ✅   | `FileTreeSidebar`, `GlobalLayout`                                    |
| Create / rename / move / delete (md + dirs) |   ✅   | `/api/file`, `/api/dir`, `/api/path`                                 |
| Read / update with optimistic concurrency   |   ✅   | `etag` / `lastModified` in `handlePutFile`                           |
| Edit ↔ Preview tabs                         |   ✅   | `FileViewerTabs`; hard toggle (not live WYSIWYG)                     |
| Path sandboxing inside `CONTENT_ROOT`       |   ✅   | `PathResolver`                                                       |
| Sidebar filter by **filename**              |   ✅   | `filterQuery` — name/path only, not file contents                    |
| "Fix Format" via OpenRouter                 |   ✅   | Client-side only (`openrouter/`)                                     |
| `[[wikilinks]]` (clickable) + resolution    |   ✅   | `markdown.ts`, `remarkWikilinks`                                     |
| Backlinks panel                             |   ✅   | `/api/backlinks`, `BacklinksPanel`                                   |
| Frontmatter + `#tags` parsing               |   ✅   | `@repo/shared` `markdown.ts`; chips in preview                       |
| Rich renderer (GFM, math, highlight)        |   ✅   | `react-markdown` + remark-gfm/math, rehype-katex                     |
| Full-text + tag search (Ctrl/Cmd-K)         |   ✅   | `/api/search`, `SearchDialog`                                        |
| Semantic (relevance) search                 |   ✅   | `/api/semantic-search`, `semantic.ts` (TF-IDF)                       |
| Provenance / audit feed (Activity tab)      |   ✅   | `X-Actor`, `AuditLog`, `/api/audit`, `ActivityPanel`                 |
| Agent-edit review/approval queue            |   ✅   | `/api/proposals`, `ProposalStore`, `ReviewPanel`                     |
| Granular agent writes (append/prepend/      |   ✅   | `PATCH /api/file`, `patch.ts`, `patch_note` MCP tool                 |
| section + idempotency + dry-run)            |        |                                                                      |
| Block anchors (`^id`) + stable note ids     |   ✅   | `blocks.ts`, `noteId.ts`, `/api/block[-anchors]`                     |
| Typed wikilinks (`[[T\|rel:supports]]`)     |   ✅   | `markdown.ts`, `Backlink.type`                                       |
| **MCP server** (agent tools)                |   ✅   | `apps/mcp` (16 tools) — writes as `agent:mcp`                        |
| Self-contained MCP launch (embedded API)    |   ✅   | `npm run start:agent` → bin `fsbrain-mcp`, see CONNECT.md            |
| Fresh-clone e2e MCP test (in `npm test`)    |   ✅   | `apps/mcp/src/__tests__/freshClone.test.ts`                          |
| Live layer (SSE + file watcher)             |   ✅   | `events/` EventBus + `fs.watch`, `GET /api/events`, `useVaultEvents` |
| `npm run build` green (all workspaces)      |   ✅   | NodeNext `.js` imports + shared `rootDir`                            |

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
| Structured knowledge (note IDs, block anchors `^id`, |    P1    |   ✅   |
| typed link graph)                                    |          |        |
| Section/append/patch writes + idempotency + dry-run  |    P1    |   ✅   |
| Live state (SSE/WebSocket + file watcher)            |    P2    |   ✅   |
| Context-bundle retrieval endpoint (token-budgeted)   |    P2    |   ⬜   |
| Auth, per-agent scopes, path-level permissions       |    P2    |   ⬜   |

‡ chunking + TF-IDF cosine ranking shipped (`semantic.ts`, no API key, runs
offline); swapping in real vector embeddings via a provider is the follow-up.
Structured knowledge: Obsidian-style block anchors (`^id`), a frontmatter
`id:` for stable note identity (opt-in), and typed wikilinks
`[[Target|rel:type]]` all shipped together; a visual link graph view is the
remaining follow-up.

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
   `apps/mcp` stdio server exposing the vault as 16 tools. Self-contained: when
   `API_BASE_URL` is unset it starts the storage API in-process on
   `127.0.0.1` (ephemeral port), auto-creates `CONTENT_ROOT`
   (default `~/.fsbrain/vault`), and seeds a `welcome.md` on first run.
   Bundled to a single-file bin via esbuild (`fsbrain-mcp` →
   `apps/mcp/dist/server.js`) so an MCP host can spawn it with one
   `node dist/server.js`. Writes carry `X-Actor: agent:mcp` (override via
   `MCP_ACTOR`) and flow through the audit trail. Copy-paste host configs
   for OpenClaw / Claude Desktop / Claude Code / Cursor:
   [`CONNECT.md`](CONNECT.md). The clone-and-run guarantee is enforced by
   `apps/mcp/src/__tests__/freshClone.test.ts`, which spawns the bin as a
   real stdio child against a temp vault and asserts writes land on disk
   and in the audit log — runs in `npm test`.
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
8. **Slice 7 — Granular agent writes.** ✅ Done.
   `PATCH /api/file` (and the `patch_note` MCP tool) apply `append`,
   `prepend`, or `replace_section` ops without rewriting the whole note.
   Pure transforms live in `@repo/shared` (`patch.ts`). The endpoint reuses
   the `etag` optimistic-concurrency contract, accepts an `idempotencyKey`
   so a retried patch is a no-op (in-memory LRU cache; resets on API
   restart), supports `dryRun` to preview without writing or auditing, and
   records audit attribution via `X-Actor`.
9. **Slice 8 — Structured knowledge.** ✅ Done.
   Obsidian-style **block anchors** (`^id`) give agents stable addresses
   inside a note. Pure helpers live in `@repo/shared` (`blocks.ts`):
   `extractBlockAnchors`, `findBlock` (paragraph / list-item /
   heading-section), `upsertBlockAnchor`. `GET /api/block` returns a block
   - surrounding context; `GET /api/block-anchors` lists every anchor.
     `PATCH /api/file` gains a `replace_block` op (anchor re-attached so the
     block stays addressable) and an `ensure_id` op (adds frontmatter `id:`
     if missing — idempotent). `/api/file` and the patch endpoint accept
     `id=` as an alternative to `path=`. Wikilink parsing recognizes
     `[[Target|rel:supports]]` and `/api/backlinks` surfaces the relation
     (`type`). The MCP server adds `read_block` and `get_block_anchors`, and
     `patch_note` exposes `replace_block` / `ensure_id`. The preview
     unobtrusively renders trailing `^id` markers; everything else stays the
     same. Provenance is preserved — block writes audit under the requesting
     actor like any other PATCH.

### Prioritization

This is a **local, single-user tool optimized for agent interaction on the
owner's machine** — not a multi-user / externally-exposed service. So the
priorities are **agent depth** plus a **visual graph** for the human. Multi-user
concerns (authn/z, per-agent scopes, rate limiting), CI, attachments, editor
polish, mobile, and multi-device sync are **explicitly deprioritized** for now.

10. **Slice 9 — Live layer.** ✅ Done.
    An in-process `EventBus` (`apps/api/src/events/eventBus.ts`) receives a
    `VaultEvent` (`@repo/shared`) from every mutating handler, published beside
    the audit write so the live stream and the audit log never diverge. A
    recursive `fs.watch` watcher (`watcher.ts`, ~150ms debounce) publishes
    `source:'watch'` events for out-of-band edits, ignoring `.fsbrain/` and
    non-`.md` churn and de-duping against API writes within a short window.
    `GET /api/events` (`sse.ts`) streams events over SSE with heartbeats and
    disconnect cleanup. The web `useVaultEvents` hook subscribes via
    `EventSource`, auto-reconnects, and surgically refreshes the tree, the open
    file (preserving unsaved drafts — a "changed on disk" prompt rather than a
    clobber), the Activity feed, and the Review badge; a live/reconnecting
    indicator sits in the layout. The MCP server's embedded API starts the bus
    - watcher too. Covered by `apps/api/src/routes/events.test.ts` (SSE +
      watcher + `.fsbrain` exclusion) and
      `apps/web/src/hooks/__tests__/useVaultEvents.test.ts`.

### Next up (open, in priority order)

11. **Real embeddings + index cache + context bundles.** Swap the TF-IDF ranker
    for vector embeddings (remote `/v1/embeddings` or on-device); cache the
    chunk/IDF index (invalidate on writes); add a token-budgeted context-bundle
    endpoint for RAG.
12. **Visual graph view** (human) — render the wikilink graph (now with `rel:`
    relations); Mermaid diagrams.

Deferred (not a priority for the local/agent focus): authn/z + per-agent scopes,
CI pipeline, non-markdown attachments, editor ergonomics (palette/outline/daily
notes/WYSIWYG), version history/Git sync, plugins/themes/mobile/sync. Proposal
follow-ups also deferred: settled-proposal retention/pruning, a computed
line-level diff in the Review UI, and closing the no-`baseEtag` update TOCTOU.

The vault is now natively an agent's brain _and_ auditable by the human; the work
above deepens agent interaction on the local machine.

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
npm install          # install workspaces
npm run dev:api      # API   → http://localhost:3001
npm run dev:web      # web   → http://localhost:5173
npm run start:agent  # self-contained MCP server on stdio (fsbrain-mcp)
npm run doctor       # preflight: Node version + vault writable
npm test             # all workspace tests (vitest), incl. fresh-clone MCP e2e
npm run lint         # eslint
npm run build        # tsc/vite/esbuild build across workspaces (produces the MCP bin)
```
