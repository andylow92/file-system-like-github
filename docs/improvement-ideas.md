# Improvement ideas — self-improvement loops

> Brainstorm of where to take the vault next, focused on **closing feedback
> loops** the existing infrastructure already collects signal for (audit log,
> proposal approve/reject outcomes, `think` gap analysis, dream-cycle
> maintenance). Captured 2026-06; complements the prioritized backlog in
> [`implementation.md`](implementation.md) (items #13–20) rather than
> replacing it.

The repo already has every piece a self-improvement loop needs — provenance,
a human-gated proposal queue, retrieval with gap analysis, and an offline
maintenance scan. What's missing is that nothing _reads the signal back_.
These ideas close those loops, in rough order of leverage.

---

## 1. Skill notes — procedural memory the agent grows itself

The vault stores **declarative** knowledge (facts, notes). Add a convention
for **procedural** knowledge: notes with `type: skill` frontmatter containing
a goal, steps, and gotchas.

- Expose `list_skills` / `get_skill` MCP tools (thin reads over the existing
  tree + frontmatter parsing).
- Nudge the agent (via tool descriptions) to `propose_edit` a new or updated
  skill note after completing a task — "write down what worked."
- The human approves it in the Review tab like any proposal.

Over time the agent distills its own successful workflows into reusable,
human-audited playbooks. Needs almost no new infrastructure: a frontmatter
convention + two thin read tools + a prompt nudge. Pairs naturally with
backlog #19 (schema packs) — `skill` becomes one of the canonical types.

## 2. Learn from the review queue

Proposals record approve/reject outcomes, but nothing ever reads that signal.
Mine it:

- Track approval rates per proposal category (broken-link stubs, duplicate
  cross-links, future skill notes).
- Auto-tune the dream cycle: if duplicate-detection proposals keep getting
  rejected, raise the cosine-similarity threshold; if they're always
  approved, get more aggressive.

The proposal store is a labeled training set we already collect and discard.
A deterministic, offline tuner fits the repo's "no LLM, pure helpers"
constraint.

## 3. Question log → gap-driven growth

`think` computes `uncoveredTerms` and `weakCoverage` per query, then throws
them away. Persist them (e.g. `.fsbrain/questions.jsonl`, beside the audit
log). That answers: _what does the vault keep getting asked that it can't
answer?_ Recurring gaps become maintenance findings — "3 queries this week
hit weak coverage on 'deployment rollback'; propose a stub note?" The vault
learns what knowledge it's missing from actual usage rather than static
analysis.

## 4. Implicit relevance feedback for ranking

When an agent runs `hybrid_search` and then `read_note`s result #3 and cites
it via `think`, that's a relevance label. Correlate search→read/cite
sequences from the audit log and use them two ways:

- a small learned per-note ranking prior;
- auto-generated fixtures for the **retrieval eval harness** (backlog #20).

The eval harness is the prerequisite for _any_ self-tuning — the system must
have a regression measure before it's allowed to adjust itself.

## 5. Freshness / decay scoring

Track last-modified vs. how often a note is retrieved. "Stale but
load-bearing" notes (old, heavily cited) are the highest-risk content —
surface them as a maintenance finding ("review this?"). Cheap, deterministic,
and makes the dream cycle feel genuinely alive.

---

## Quick wins that unlock the above

- **CI pipeline.** The test suite (including the fresh-clone MCP e2e) runs
  only locally. A single GitHub Actions workflow running
  `npm test && npm run lint && npm run build` protects everything else.
- **Git-backed version history for the vault.** Auto-commit on writes (or
  snapshot per proposal approval) gives undo for agent writes — a trust
  unlock that makes the loops above safe to run more autonomously.
- **Backlog #18–19** (self-wiring typed edges, schema packs) pair naturally
  with skill notes.
- **Real embeddings (#13)** behind the existing seam — with the eval harness
  (#20) in place first, so the swap is _proven_ to improve recall rather than
  assumed.

## Suggested sequence

**CI → eval harness (#20) → skill notes (#1) → question log (#3) →
review-queue tuning (#2).** Every self-improvement mechanism lands on top of
a safety net, and each reuses the proposal/audit/think plumbing — no new
subsystems.
