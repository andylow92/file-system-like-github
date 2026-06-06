# AGENTS.md

> **Entry point for AI agents working in this repository.**
> Read this file first. It tells you where the knowledge lives and the rules
> you must follow while working here.

This project is a **local-first markdown workspace** (a GitHub-style file tree
over a filesystem-backed API) that is being grown into a **shared "brain"**:
plain markdown files that **humans edit and read**, and that **agents can also
read, search, link, and write** — with every change legible to the human.

If you are an agent operating this vault, you do not have to scrape the UI:
there is a first-class **MCP server** (`apps/mcp`) that exposes the vault as
tools, and every write you make is recorded with attribution so the human can
see it. See _What's built_ below.

---

## Where the knowledge lives (route yourself here)

Always orient yourself using these documents before acting:

| You want to know...                              | Read this                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| What exists, what's done, what's next            | [`docs/implementation.md`](docs/implementation.md)               |
| How to run, test, and validate the app           | [`docs/implementation.md`](docs/implementation.md) → _Commands_  |
| Manual integration checks                        | [`docs/integration-test-plan.md`](docs/integration-test-plan.md) |
| Backend API endpoints + request/response shapes  | [`apps/api/README.md`](apps/api/README.md)                       |
| Agent tools (MCP) + how writes are attributed    | [`apps/mcp/README.md`](apps/mcp/README.md)                       |
| Connect an MCP host (OpenClaw / Claude / Cursor) | [`docs/CONNECT.md`](docs/CONNECT.md)                             |
| Project overview / human-facing pitch            | [`README.md`](README.md)                                         |

`docs/implementation.md` is the **source of truth for project state**. When you
finish a unit of work, update it (see _Goal-driven execution_ below).

---

## What's built (current surface)

Done and on `main`-track (details + status tables in `docs/implementation.md`):

- **Files & tree** — GitHub-style tree, CRUD for `.md` files and folders,
  optimistic-concurrency writes (`etag` / `lastModified`), `CONTENT_ROOT`
  sandboxing. Hidden dotfiles/dirs (e.g. `.fsbrain/`) are excluded from the tree.
- **Links & metadata** — `[[wikilinks]]` (clickable, resolved), a backlinks
  panel (`GET /api/backlinks`), and frontmatter + `#tags` parsing. The pure
  helpers live in `@repo/shared` (`markdown.ts`).
- **Rich rendering** — the preview uses `react-markdown` + `remark-gfm`
  (tables, task lists, strikethrough, autolinks, h3–h6), `remark-math` +
  `rehype-katex` (math), and highlight.js for fenced code (with a copy button).
  Frontmatter is stripped and tags render as chips. Wikilinks are a remark
  plugin (`apps/web/src/markdown/remarkWikilinks.ts`).
- **Search** — full-text + tag search (`GET /api/search`), **semantic
  (relevance) search** (`GET /api/semantic-search`, TF-IDF cosine over chunked
  notes; `semantic.ts`), and **hybrid retrieval** (`GET /api/hybrid-search`)
  that fuses the two by Reciprocal Rank Fusion (`hybrid.ts`,
  `reciprocalRankFusion`) so neither exact keyword nor conceptual matches are
  missed. The Ctrl/Cmd-K quick-switcher has a Text|Semantic|Hybrid toggle
  (prefix `#` for tags in Text mode). All three run offline, no API key; the
  ranking engine is swappable for real embeddings later.
- **Provenance** — mutations read an `X-Actor` header (default `human`) and are
  appended to an audit log (`CONTENT_ROOT/.fsbrain/audit.jsonl`), exposed via
  `GET /api/audit` and a web **Activity** tab with human-vs-agent badges.
- **Edit review queue** — instead of writing directly, an agent can submit a
  **proposal** (`POST /api/proposals`, or the `propose_edit` MCP tool) for a
  create/update/delete. A human reviews the before/after in the web **Review**
  tab and approves (the edit is applied and audited as the proposing agent) or
  rejects. Proposals live in `CONTENT_ROOT/.fsbrain/proposals/`. Both
  destructive paths (`update`, `delete`) honor `baseEtag` and 409 on a stale
  approval. Resolution is human-only — agents get `propose_edit` /
  `list_proposals`, the MCP server omits a resolve tool, and the API rejects an
  `agent:` resolver (403). This is convention-level (X-Actor is unauthenticated);
  airtight enforcement would need authn/z, intentionally out of scope for this
  local, single-user tool.
- **Granular agent writes** — `PATCH /api/file` (or the `patch_note` MCP
  tool) applies `append`, `prepend`, `replace_section`, `replace_block`, or
  `ensure_id` ops without rewriting the whole note. It reuses the `etag`
  optimistic-concurrency contract, accepts an `idempotencyKey` so a retried
  patch is a no-op (keys cached in memory for the API process lifetime), and
  supports `dryRun` to preview the result without writing or auditing. The
  pure text-transform helpers live in `@repo/shared` (`patch.ts`).
- **Structured knowledge** — Obsidian-style **block anchors** (`^id`) give
  agents stable, citable addresses inside a note: `GET /api/block` /
  `GET /api/block-anchors` (and the `read_block` / `get_block_anchors` MCP
  tools) read by block; the `replace_block` patch op overwrites a block,
  reattaching the anchor so future reads still resolve. A frontmatter
  **`id:`** is the note's stable identity (opt-in via the `ensure_id` patch
  op), accepted as `?id=` on `/api/file` / `/api/block` reads and on the
  patch endpoint. **Typed wikilinks** `[[Target|rel:supports]]` surface a
  relation on `/api/backlinks` (plain aliases still work). Pure helpers live
  in `@repo/shared` (`blocks.ts`, `noteId.ts`).
- **Knowledge graph** — the vault's `[[wikilink]]` graph is rendered as an
  interactive, force-directed **Graph** tab in the web UI (click a node to open
  the note, hover to highlight its neighbors, unresolved link targets shown as
  distinct placeholders, live-refreshed on vault changes) and exposed for agent
  traversal at `GET /api/graph` (and the `get_graph` MCP tool) as `GraphData`
  (`{ nodes: { id, label, tags, unresolved? }, edges: { source, target, type? } }`).
  It is built from the same link extraction as backlinks, served from the cached
  index, and excludes `.fsbrain/`. The pure builder lives in `@repo/shared`
  (`graph.ts`); the renderer (`apps/web` `KnowledgeGraph`) is lazy-loaded.
- **MCP server** (`apps/mcp`) — a stdio server exposing 21 vault tools
  (`list_notes`, `read_note`, `read_block`, `get_block_anchors`,
  `create_note`, `update_note`, `patch_note`, `search_notes`,
  `semantic_search`, `hybrid_search`, `get_context`, `think`, `get_backlinks`,
  `get_graph`, `recent_activity`, `create_folder`, `move_path`, `delete_path`,
  `propose_edit`, `list_proposals`, `run_maintenance`). It runs
  the storage API **in-process** by default, so it is a single
  self-contained command an MCP host (OpenClaw, Claude Desktop, Claude
  Code, Cursor) can spawn — `npm run start:agent` from the repo root, or
  the bundled `node apps/mcp/dist/server.js`. Copy-paste host configs live
  in [`docs/CONNECT.md`](docs/CONNECT.md). On startup it prints a one-line
  readiness banner on stderr (`fsbrain-mcp ready · mode=… · vault=… ·
tools=… · actor=…`) so a host log immediately shows whether the spawn
  worked. Agent writes carry `X-Actor: agent:mcp` (override via
  `MCP_ACTOR`) and flow through the same validation, optimistic-
  concurrency, and audit trail as the web UI.
- **Clone-and-run guarantee** — `apps/mcp/src/__tests__/freshClone.test.ts`
  spawns the MCP bin as a real stdio child against a temp `CONTENT_ROOT`,
  drives it via the official MCP SDK client (tools/list + create/read/
  search/semantic_search + propose_edit/list_proposals + recent_activity),
  and asserts the write landed both on disk and in the audit log. Runs in
  `npm test`, so a green test bar is the proof that a fresh clone works.
- **Live layer** — the web UI reflects vault changes the moment they happen.
  An in-process `EventBus` (`apps/api/src/events/`) gets a `VaultEvent` from
  every mutating handler right beside its audit write, and a recursive
  `fs.watch` watcher publishes `source:'watch'` events for out-of-band edits
  (direct file edits, `git`, another process) — ignoring `.fsbrain/` and
  non-`.md` churn and de-duping against API writes. `GET /api/events` streams
  these over SSE; the web `useVaultEvents` hook subscribes and surgically
  refreshes the tree, the open file (preserving unsaved drafts), the Activity
  feed, and the Review badge, with a live/reconnecting indicator. The embedded
  API the MCP server launches starts the bus + watcher too, so an agent's
  writes surface to a watching human in real time.
- **RAG retrieval — cached index + context bundles** — a first-class retrieval
  layer for agents. An in-memory `VaultIndex` (`apps/api/src/index/`) chunks
  every note and computes IDF + per-chunk vectors once, reusing them across
  queries; it subscribes to the live-layer `EventBus` so any create/update/
  move/delete invalidates it and the next query rebuilds from disk (reusing
  cached content of unchanged notes) — never stale after a write. Both
  `/api/search` and `/api/semantic-search` read through it. `GET /api/context`
  (and the `get_context` MCP tool) assembles a token-budgeted **context
  bundle**: the top query-ranked passages plus — for a focus note — that note
  and its backlinks as neighbor context, de-duped and packed to a token budget
  (`ceil(chars/4)`, no tokenizer). Stays fully local/offline; the bundle-shaping
  helpers are pure (`@repo/shared` `context.ts`) and the ranking engine is
  swappable for real embeddings later behind the same `documents → ranked`
  contract.
- **Brain layer — `think` (cited answers + offline gap analysis)** — turns a
  question into a **grounded answer kit** instead of raw pages. `GET /api/think`
  (and the `think` MCP tool) runs hybrid retrieval, assembles a context bundle,
  and returns numbered **citations** (`[1]`, `[2]`…) mapped to source passages
  (path + heading + `^block` anchor), the passages, and a deterministic,
  **offline gap analysis** (`weakCoverage` + `uncoveredTerms` — "what the vault
  doesn't yet cover"), computed from retrieval scores with **no model**. The
  kit-shaping is pure (`@repo/shared` `think.ts` — `assembleAnswerKit`). Offline
  by default: the calling agent is the LLM and composes the final cited answer
  from the kit; a server-side `OPENROUTER_API_KEY` + `?synthesize=1` optionally
  adds a synthesized prose `answer`.
- **Dream-cycle maintenance** — a deterministic, offline scan
  (`@repo/shared` `maintenance.ts`, `scanVault`) finds vault-hygiene problems —
  **broken `[[wikilinks]]`**, **orphan notes**, and **near-duplicate notes**
  (note-level TF-IDF cosine) — and files each actionable one as an **edit
  proposal** the human approves in the Review tab (reusing the `ProposalStore` +
  `EventBus`). `GET /api/maintenance` previews; `POST /api/maintenance/scan` (and
  the `run_maintenance` MCP tool) files suggestions as a distinct
  `agent:maintenance` actor and is **idempotent** — it dedupes against open
  proposals, so re-running never spams the queue. On-demand by default (optional
  `MAINTENANCE_INTERVAL_MS` timer). Resolution stays human-only; contradiction
  detection is a deferred follow-up (it needs an LLM, out of the offline scope).

**Not yet built (next):** Mermaid diagrams and real vector embeddings to back
semantic search (the cached index + context bundle endpoint above are the seam
for it). See the roadmap in `docs/implementation.md`.

---

## Repository map (quick orientation)

```
apps/
  api/   # Node HTTP server + filesystem storage (CONTENT_ROOT). Endpoints under /api/*.
         # events/ (live SSE), index/ (cached retrieval VaultIndex behind search/context).
  web/   # React + Vite UI: file tree, editor/preview/activity tabs, Ctrl/Cmd-K search.
  mcp/   # MCP stdio server exposing the vault as agent tools. Embeds the API in-process
         # by default; bundled to a single bin (`apps/mcp/dist/server.js`, npm `fsbrain-mcp`).
packages/
  shared/  # Shared TS contracts + pure utilities: markdown.ts, search.ts, semantic.ts,
           # context.ts (token-budgeted bundle packing), graph.ts (wikilink graph).
docs/      # Agent + human knowledge base. Start at implementation.md.
```

- `@repo/shared` is consumed **as source** (`main: src/index.ts`). It has no test
  runner of its own — co-locate its unit tests in `apps/api` (node vitest).
- The API is **markdown-focused** and sandboxed to `CONTENT_ROOT`; path handling
  rejects traversal and absolute paths. Keep those guarantees intact.
- **Provenance is a guarantee, not an option:** any new mutating path must read
  `X-Actor` and record an `AuditEntry`. Don't add writes that bypass the log.
- **When the human should sign off on a change, propose it** (`propose_edit` /
  `POST /api/proposals`) rather than writing directly. Resolving proposals is
  human-only; don't add an agent path that approves them.
- Relative imports under the API/MCP packages (NodeNext) use explicit `.js`
  extensions. `npm run build` is green across all workspaces — keep it green.

---

## Operating Rules

### Think before coding

- State assumptions.
- Surface tradeoffs.
- Ask before guessing.
- Push back when a simpler approach exists.

### Simplicity first

- Write the minimum code that solves the problem.
- No speculative features.
- No abstractions for one-off code.

### Surgical changes

- Touch only what is necessary.
- Do not refactor adjacent code.
- Match existing style.

### Goal-driven execution

- Define success criteria.
- Verify before claiming completion.
- Iterate until the goal is met.

---

## Claude Code Rules

### Prevent agent fights

- Do not run multiple agents against the same files unless explicitly asked.
- Before using subagents, state ownership boundaries.

### Avoid hook cascades

- Before editing hooks, inspect existing hooks.
- Do not add hooks that trigger other hooks without explaining the chain.

### Control skill loading

- Load only skills relevant to the current task.
- Do not invoke broad skills when a simple edit is enough.

### Preserve workflow state

- For multi-step work, keep a brief checklist.
- Before compacting or ending a session, summarize current state, blockers, and
  next step.

### Verify with project commands

- Prefer existing test, lint, typecheck, and build commands.
- Do not invent commands when package scripts or Make targets exist.

### Protect local and secret files

- Do not edit `.env`, secrets, credentials, local configs, or generated files
  unless explicitly asked.

### Respect repo boundaries

- In monorepos, identify the package/app being changed before editing.
- Do not apply conventions from one package to another without checking.

### Escalate uncertainty

- If instructions conflict, stop and ask.
- If a change has security, data-loss, migration, or production-risk
  implications, call that out before editing.

---

## Project commands (do not invent new ones)

```bash
npm install        # install workspaces
npm run dev:api    # run API   (http://localhost:3001)
npm run dev:web    # run web UI (http://localhost:5173)
npm run start:agent  # launch the self-contained MCP server (`fsbrain-mcp`, stdio)
npm run doctor     # preflight: Node version + vault writable
npm test           # run all workspace tests (vitest), incl. fresh-clone MCP e2e
npm run lint       # eslint
npm run build      # tsc/vite/esbuild build across workspaces (produces the MCP bin)
npm run format     # prettier --check
```

When you finish a change: run `npm test`, `npm run lint`, and `npm run build`,
then update `docs/implementation.md` to reflect the new state.
