/**
 * Pure helpers for the **question log** — the vault learning what it gets
 * asked but cannot answer.
 *
 * Every `think` query already produces an offline gap analysis
 * (`weakCoverage` + `uncoveredTerms`); the API persists that signal per query
 * (`.fsbrain/questions.jsonl`, beside the audit log) instead of throwing it
 * away. These helpers turn the raw log into **recurring knowledge gaps**:
 * terms that keep showing up uncovered across questions. A recurring gap is a
 * demand-driven signal of what note to write next — usage tells the vault
 * what it's missing, rather than static analysis.
 *
 * Deterministic and dependency-free, like the rest of `@repo/shared`: same
 * entries in, same gaps out.
 */

/** One logged `think` question and its offline gap signal. */
export interface QuestionEntry {
  /** ISO timestamp the question was asked. */
  ts: string;
  /** Who asked, e.g. `human` or `agent:mcp` (from `X-Actor`). */
  actor: string;
  /** The question as asked. */
  query: string;
  /** Whether retrieval coverage was weak (from the answer kit's gap analysis). */
  weakCoverage: boolean;
  /** Query terms no retrieved passage covered. */
  uncoveredTerms: string[];
}

/** A term that keeps going uncovered — a candidate note to write. */
export interface KnowledgeGap {
  /** The uncovered term (lowercased). */
  term: string;
  /** How many logged questions left this term uncovered. */
  count: number;
  /** Distinct example questions that hit the gap (most recent first, capped). */
  queries: string[];
  /** ISO timestamp of the most recent question that hit the gap. */
  lastTs: string;
}

export interface FindKnowledgeGapsOptions {
  /** Minimum questions that must share an uncovered term (default 2). */
  minCount?: number;
  /** Max example queries kept per gap (default 5). */
  maxQueries?: number;
}

/**
 * Group the log's uncovered terms into recurring {@link KnowledgeGap}s: a term
 * qualifies once at least `minCount` questions left it uncovered (repeats of
 * the same question count — asking twice is demand). Sorted by count
 * descending, ties broken by term for determinism.
 */
export function findKnowledgeGaps(
  entries: readonly QuestionEntry[],
  options: FindKnowledgeGapsOptions = {},
): KnowledgeGap[] {
  const minCount = options.minCount ?? 2;
  const maxQueries = options.maxQueries ?? 5;

  const byTerm = new Map<
    string,
    { count: number; queries: string[]; querySet: Set<string>; lastTs: string; lastMs: number }
  >();

  for (const entry of entries) {
    const seenInEntry = new Set<string>();
    for (const raw of entry.uncoveredTerms) {
      const term = raw.trim().toLowerCase();
      if (!term || seenInEntry.has(term)) {
        continue; // a term counts once per question
      }
      seenInEntry.add(term);

      const gap = byTerm.get(term) ?? {
        count: 0,
        queries: [],
        querySet: new Set<string>(),
        lastTs: entry.ts,
        lastMs: Date.parse(entry.ts),
      };
      gap.count += 1;
      // Compare parsed timestamps, not strings — lexicographic order breaks on
      // mixed precision or non-UTC offsets.
      const entryMs = Date.parse(entry.ts);
      if (entryMs > gap.lastMs) {
        gap.lastMs = entryMs;
        gap.lastTs = entry.ts;
      }
      if (!gap.querySet.has(entry.query)) {
        gap.querySet.add(entry.query);
        gap.queries.push(entry.query);
        // Keep only the most recent `maxQueries` examples, in capture order.
        if (gap.queries.length > maxQueries) {
          gap.queries.shift();
        }
      }
      byTerm.set(term, gap);
    }
  }

  return [...byTerm.entries()]
    .filter(([, gap]) => gap.count >= minCount)
    .map(([term, gap]) => ({
      term,
      count: gap.count,
      // Most recent first: entries arrive oldest-first, so reverse the capture order.
      queries: [...gap.queries].reverse(),
      lastTs: gap.lastTs,
    }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}
