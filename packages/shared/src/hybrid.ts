/**
 * Pure, dependency-free **Reciprocal Rank Fusion (RRF)** — the fusion step of
 * the vault's hybrid retrieval.
 *
 * Lexical (full-text / filename substring) and semantic (TF-IDF cosine) search
 * each rank notes by a different, non-comparable score: an occurrence count vs.
 * a cosine in [0, 1]. RRF combines them by *rank position* alone, so neither
 * score scale has to be normalized. A note ranked highly by either engine — or
 * modestly by both — floats to the top, which is what lifts recall over either
 * engine used alone.
 *
 * It stays pure and deterministic (ties break on the item key) so it runs in the
 * API, the browser, and tests without any model, index, or API key — matching
 * the rest of `@repo/shared`. The API layer feeds it two ranked lists of note
 * paths and projects the fused order onto display hits (`HybridHit`).
 */

/** One ranked input list for fusion. */
export interface RankingInput {
  /**
   * Item keys in rank order, best first (index 0 = rank 1). A repeated key keeps
   * its first (best) position; later occurrences are ignored.
   */
  keys: string[];
  /** Relative influence of this ranking in the fused score (default `1`). */
  weight?: number;
  /** Label recorded on every fused item this ranking contributed to. */
  label?: string;
}

/** A fused result: an item key, its summed RRF score, and which rankings hit it. */
export interface FusedItem {
  key: string;
  /** Σ over contributing rankings of `weight / (k + rank)` (rank is 1-based). */
  score: number;
  /** Labels of the rankings that contained this key, in input order. */
  sources: string[];
}

/**
 * A fused hybrid-search hit returned by `GET /api/hybrid-search` (and the
 * `hybrid_search` MCP tool). Projects a {@link FusedItem} onto a displayable
 * note hit, preferring an exact lexical line as the snippet and falling back to
 * the semantic chunk.
 */
export interface HybridHit {
  path: string;
  /** Basename of the matched note. */
  name: string;
  /** Fused RRF score (rounded to 4dp); meaningful only *within* one query. */
  score: number;
  /** Best display snippet — the exact lexical line when present, else the chunk. */
  snippet: string;
  /** Nearest heading for the semantic chunk, when that is the snippet source. */
  heading?: string;
  /** 1-based line of the lexical match (0 when only the semantic engine hit). */
  line: number;
  /** Tags declared by the note. */
  tags: string[];
  /** Which engines matched this note: `'text'` and/or `'semantic'`. */
  sources: ('text' | 'semantic')[];
}

/** The standard RRF damping constant from the original Cormack et al. paper. */
export const DEFAULT_RRF_K = 60;

/**
 * Fuse several ranked lists into one by Reciprocal Rank Fusion. With damping
 * constant `k`, an item at rank `r` contributes `weight / (k + r)`; contributions
 * sum across every list that contains the item. The output is sorted by score
 * descending, ties broken by key for determinism.
 */
export function reciprocalRankFusion(
  rankings: RankingInput[],
  options: { k?: number } = {},
): FusedItem[] {
  const k = options.k ?? DEFAULT_RRF_K;
  const fused = new Map<string, { score: number; sources: string[] }>();

  for (const ranking of rankings) {
    const weight = ranking.weight ?? 1;
    const seen = new Set<string>();
    ranking.keys.forEach((key, position) => {
      if (seen.has(key)) {
        return; // keep the best (first) rank of a repeated key
      }
      seen.add(key);
      const rank = position + 1;
      const entry = fused.get(key) ?? { score: 0, sources: [] };
      entry.score += weight / (k + rank);
      if (ranking.label) {
        entry.sources.push(ranking.label);
      }
      fused.set(key, entry);
    });
  }

  return [...fused.entries()]
    .map(([key, { score, sources }]) => ({ key, score, sources }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
