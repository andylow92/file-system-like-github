# AGENTS.md

> **Entry point for AI agents working in this repository.**
> Read this file first. It tells you where the knowledge lives and the rules
> you must follow while working here.

This project is a **local-first markdown workspace** (a GitHub-style file tree
over a filesystem-backed API) that is being grown into a **shared "brain"**:
plain markdown files that **humans edit and read**, and that **agents can also
read, search, link, and write** — with every change legible to the human.

---

## Where the knowledge lives (route yourself here)

Always orient yourself using these documents before acting:

| You want to know...                             | Read this                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| What exists, what's done, what's next           | [`docs/implementation.md`](docs/implementation.md)               |
| How to run, test, and validate the app          | [`docs/implementation.md`](docs/implementation.md) → _Commands_  |
| Manual integration checks                       | [`docs/integration-test-plan.md`](docs/integration-test-plan.md) |
| Backend API endpoints + request/response shapes | [`apps/api/README.md`](apps/api/README.md)                       |
| Project overview / human-facing pitch           | [`README.md`](README.md)                                         |

`docs/implementation.md` is the **source of truth for project state**. When you
finish a unit of work, update it (see _Goal-driven execution_ below).

---

## Repository map (quick orientation)

```
apps/
  api/   # Node HTTP server + filesystem storage (CONTENT_ROOT). Endpoints under /api/*.
  web/   # React + Vite UI: file tree, editor/preview tabs.
packages/
  shared/  # Shared TypeScript contracts + pure markdown utilities (@repo/shared).
docs/      # Agent + human knowledge base. Start at implementation.md.
```

- `@repo/shared` is consumed **as source** (`main: src/index.ts`). It has no test
  runner of its own — co-locate its unit tests in `apps/api` (node vitest).
- The API is **markdown-focused** and sandboxed to `CONTENT_ROOT`; path handling
  rejects traversal and absolute paths. Keep those guarantees intact.

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
