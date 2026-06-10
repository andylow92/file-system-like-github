/**
 * Pure, dependency-free **retrieval evaluation** helpers — the metric side of
 * the vault's eval harness (backlog #20).
 *
 * A golden fixture of `query → expected-note` pairs is run against a retrieval
 * engine (lexical, semantic, or hybrid — anything that turns a query into a
 * ranked list of note paths), and these helpers score the outcome with the two
 * standard rank metrics:
 *
 * - **recall@k** — of the expected notes, how many appear in the top `k`?
 * - **reciprocal rank (RR@k)** — `1 / rank` of the first expected note in the
 *   top `k` (0 when none made it); averaged over cases this is MRR.
 *
 * The helpers are deliberately decoupled from *how* the ranking was produced:
 * callers run the engine (an HTTP endpoint, a pure helper, a future embedding
 * provider) and pass the ranked paths in. That keeps this module pure and
 * deterministic — same inputs, same metrics — so a CI test can pin a recall
 * floor and any ranking change that silently regresses it fails loudly, with
 * `formatEvalReport` naming the exact queries that got worse.
 */

/** One golden eval case: a query and the note(s) it must retrieve. */
export interface EvalCase {
  /** Short stable identifier, used in failure reports. */
  id: string;
  /** The retrieval query an agent would issue. */
  query: string;
  /** Logical note paths that should be retrieved (the relevance judgment). */
  expected: string[];
  /** Why this case exists / which ranking behavior it guards. */
  description?: string;
}

/** The scored outcome of running one {@link EvalCase} against an engine. */
export interface EvalCaseResult {
  id: string;
  query: string;
  expected: string[];
  /** Expected paths found within the top `k` of the (de-duplicated) ranking. */
  found: string[];
  /** Expected paths absent from the top `k`. */
  missing: string[];
  /** `found.length / expected.length`, in [0, 1]. */
  recall: number;
  /** `1 / rank` of the first expected path in the top `k`; 0 when none hit. */
  reciprocalRank: number;
}

/** Aggregate metrics over a whole eval run. */
export interface EvalSummary {
  /** The cutoff the run was scored at. */
  k: number;
  results: EvalCaseResult[];
  /** Mean per-case recall@k, in [0, 1]. */
  meanRecall: number;
  /** Mean reciprocal rank (MRR@k), in [0, 1]. */
  meanReciprocalRank: number;
  /** Cases that missed at least one expected note (recall < 1). */
  failures: EvalCaseResult[];
}

/**
 * Score one case against an engine's ranked output. `ranked` is the engine's
 * note paths, best first; repeated paths (e.g. several chunks of one note from
 * a per-chunk engine) keep their first — best — position. Only the top `k`
 * distinct paths count.
 */
export function scoreEvalCase(evalCase: EvalCase, ranked: string[], k: number): EvalCaseResult {
  const topK: string[] = [];
  const seen = new Set<string>();
  for (const path of ranked) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    topK.push(path);
    if (topK.length >= k) {
      break;
    }
  }

  const expectedSet = new Set(evalCase.expected);
  const found = topK.filter((path) => expectedSet.has(path));
  const missing = evalCase.expected.filter((path) => !found.includes(path));

  const firstHit = topK.findIndex((path) => expectedSet.has(path));

  return {
    id: evalCase.id,
    query: evalCase.query,
    expected: evalCase.expected,
    found,
    missing,
    recall: evalCase.expected.length === 0 ? 1 : found.length / evalCase.expected.length,
    reciprocalRank: firstHit === -1 ? 0 : 1 / (firstHit + 1),
  };
}

/** Aggregate per-case results into mean recall@k + MRR@k and list the misses. */
export function summarizeEval(results: EvalCaseResult[], k: number): EvalSummary {
  const total = results.length || 1;
  const meanRecall = results.reduce((sum, result) => sum + result.recall, 0) / total;
  const meanReciprocalRank =
    results.reduce((sum, result) => sum + result.reciprocalRank, 0) / total;

  return {
    k,
    results,
    meanRecall: Number(meanRecall.toFixed(4)),
    meanReciprocalRank: Number(meanReciprocalRank.toFixed(4)),
    failures: results.filter((result) => result.recall < 1),
  };
}

/**
 * A compact human-readable report of an eval run — embedded in test assertion
 * messages so a regressed ranking change names the exact queries it broke.
 */
export function formatEvalReport(label: string, summary: EvalSummary): string {
  const lines = [
    `${label}: recall@${summary.k}=${summary.meanRecall} MRR@${summary.k}=${summary.meanReciprocalRank} (${summary.results.length} cases, ${summary.failures.length} with misses)`,
  ];
  for (const failure of summary.failures) {
    lines.push(`  ✗ [${failure.id}] "${failure.query}" missing: ${failure.missing.join(', ')}`);
  }
  return lines.join('\n');
}
