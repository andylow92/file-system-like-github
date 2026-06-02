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

| You want to know...                             | Read this                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| What exists, what's done, what's next           | [`docs/implementation.md`](docs/implementation.md)               |
| How to run, test, and validate the app          | [`docs/implementation.md`](docs/implementation.md) → _Commands_  |
| Manual integration checks                       | [`docs/integration-test-plan.md`](docs/integration-test-plan.md) |
| Backend API endpoints + request/response shapes | [`apps/api/README.md`](apps/api/README.md)                       |
| Agent tools (MCP) + how writes are attributed   | [`apps/mcp/README.md`](apps/mcp/README.md)                       |
| Project overview / human-facing pitch           | [`README.md`](README.md)                                         |

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
- **Search** — full-text + tag search (`GET /api/search`) and **semantic
  (relevance) search** (`GET /api/semantic-search`, TF-IDF cosine over chunked
  notes; `semantic.ts`). The Ctrl/Cmd-K quick-switcher has a Text|Semantic
  toggle (prefix `#` for tags in Text mode). Semantic runs offline, no API key;
  the ranking engine is swappable for real embeddings later.
- **Provenance** — mutations read an `X-Actor` header (default `human`) and are
  appended to an audit log (`CONTENT_ROOT/.fsbrain/audit.jsonl`), exposed via
  `GET /api/audit` and a web **Activity** tab with human-vs-agent badges.
- **Edit review queue** — instead of writing directly, an agent can submit a
  **proposal** (`POST /api/proposals`, or the `propose_edit` MCP tool) for a
  create/update/delete. A human reviews the diff in the web **Review** tab and
  approves (the edit is applied and audited as the proposing agent) or rejects.
  Proposals live in `CONTENT_ROOT/.fsbrain/proposals/`. Approval/rejection is a
  human-only action — agents can `propose_edit` and `list_proposals`, not
  resolve.
- **MCP server** (`apps/mcp`) — a stdio server exposing 13 vault tools
  (`list_notes`, `read_note`, `create_note`, `update_note`, `search_notes`,
  `semantic_search`, `get_backlinks`, `recent_activity`, `create_folder`,
  `move_path`, `delete_path`, `propose_edit`, `list_proposals`). It proxies the
  HTTP API, so agent writes flow through the same validation, concurrency, and
  audit trail, attributed as `agent:mcp`.

**Not yet built (next):** Mermaid diagrams, real vector embeddings to back
semantic search, and a live SSE/file-watcher layer. See the roadmap in
`docs/implementation.md`.

---

## Repository map (quick orientation)

```
apps/
  api/   # Node HTTP server + filesystem storage (CONTENT_ROOT). Endpoints under /api/*.
  web/   # React + Vite UI: file tree, editor/preview/activity tabs, Ctrl/Cmd-K search.
  mcp/   # MCP stdio server exposing the vault as agent tools (proxies the API).
packages/
  shared/  # Shared TS contracts + pure utilities: markdown.ts, search.ts, semantic.ts.
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
npm test           # run all workspace tests (vitest)
npm run lint       # eslint
npm run format     # prettier --check
```

When you finish a change: run `npm test`, `npm run lint`, and `npm run build`,
then update `docs/implementation.md` to reflect the new state.
