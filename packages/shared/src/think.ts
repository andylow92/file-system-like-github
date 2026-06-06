/**
 * Pure helpers for the `think` brain layer: turn a retrieval **context bundle**
 * (see `context.ts`) into a grounded, cited **answer kit** — numbered citations
 * the agent (or a human) can quote, plus a deterministic, **offline gap
 * analysis** ("what the vault doesn't yet cover").
 *
 * Everything here is pure and unit-tested: no model, no network, no API key. The
 * gap analysis is computed from retrieval scores + term coverage alone. The
 * optional LLM *synthesis* of a prose answer lives in the API layer behind a
 * server-side key; the agent calling the MCP `think` tool can also compose the
 * final cited answer itself from this kit.
 */
import { extractBlockAnchors } from './blocks.js';
import type { ContextBundle, ContextItem } from './context.js';
import { tokenize } from './semantic.js';

/** A numbered source backing the answer. Cite it in prose as `[n]`. */
export interface AnswerCitation {
  /** 1-based citation number; `passages[n - 1]` is the passage it points at. */
  n: number;
  /** Logical path of the cited note. */
  path: string;
  /** Nearest heading of the cited passage, when it sits under one. */
  heading?: string;
  /** A `^block-id` anchor in the passage, giving a stable, citable address. */
  block?: string;
  /** Relevance score of the passage (0 for focus-note / backlink neighbors). */
  score: number;
  /** Whether the passage was a query `match` or a focus-note `neighbor`. */
  kind: ContextItem['kind'];
  /** A trimmed excerpt of the passage, for a compact source list. */
  excerpt: string;
}

/**
 * Deterministic, offline gap analysis — computed from retrieval scores and term
 * coverage alone, no model. Surfaces where the vault is thin on the query.
 */
export interface AnswerGaps {
  /** True when the best match score is below `threshold` (or nothing matched). */
  weakCoverage: boolean;
  /** Highest `match`-passage score in the bundle (0 when nothing matched). */
  topScore: number;
  /** The weak-coverage threshold used, echoed for transparency. */
  threshold: number;
  /** Query terms with no supporting passage — "what the vault doesn't cover". */
  uncoveredTerms: string[];
}

/** A quick measure of how well the bundle backs an answer. */
export interface AnswerCoverage {
  /** Number of cited passages. */
  citations: number;
  /** Number of distinct notes cited. */
  notes: number;
  /** Best match score in the bundle. */
  topScore: number;
}

/**
 * A grounded answer kit: the passages, numbered citations, an offline gap
 * analysis, and a coverage summary. Returned by `GET /api/think` and the `think`
 * MCP tool; the agent (or the optional server-side LLM) composes the final cited
 * prose from it.
 */
export interface AnswerKit {
  query: string;
  /** Bundle passages in citation order — `passages[n - 1]` backs citation `n`. */
  passages: ContextItem[];
  citations: AnswerCitation[];
  gaps: AnswerGaps;
  coverage: AnswerCoverage;
}

export interface AssembleAnswerKitOptions {
  /** Min top match score for coverage to count as adequate (default `0.1`). */
  weakCoverageThreshold?: number;
  /** Max characters of each citation excerpt (default `240`). */
  excerptChars?: number;
}

const DEFAULT_WEAK_COVERAGE_THRESHOLD = 0.1;
const DEFAULT_EXCERPT_CHARS = 240;

/** A whitespace-collapsed, length-capped excerpt of a passage. */
function excerptOf(text: string, maxChars: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

/**
 * Build a grounded answer kit from a query and its retrieval context bundle.
 * Pure + deterministic: the same bundle always yields the same kit.
 */
export function assembleAnswerKit(
  query: string,
  bundle: ContextBundle,
  options: AssembleAnswerKitOptions = {},
): AnswerKit {
  const threshold = options.weakCoverageThreshold ?? DEFAULT_WEAK_COVERAGE_THRESHOLD;
  const excerptChars = options.excerptChars ?? DEFAULT_EXCERPT_CHARS;

  const passages = bundle.items;

  // Number every passage as a citable source (path + heading + block anchor).
  const citations: AnswerCitation[] = passages.map((item, i) => {
    const block = extractBlockAnchors(item.text)[0]?.id;
    return {
      n: i + 1,
      path: item.path,
      ...(item.heading ? { heading: item.heading } : {}),
      ...(block ? { block } : {}),
      score: item.score,
      kind: item.kind,
      excerpt: excerptOf(item.text, excerptChars),
    };
  });

  // Gap analysis (offline): weak coverage from the best match score, and which
  // query terms no passage supports.
  const matchScores = passages.filter((p) => p.kind === 'match').map((p) => p.score);
  const topScore = matchScores.length > 0 ? Math.max(...matchScores) : 0;
  const weakCoverage = topScore < threshold;

  // Compare *stems* (the same tokenizer the ranking engine uses) so a query
  // "felines" is covered by "feline" in a passage. Report the original word.
  // Coverage is measured over `passages` — the bundle's budget-packed items —
  // so a very tight token budget that drops a covering passage can surface its
  // term as uncovered; at the default budget this effectively never bites.
  const passageStems = new Set<string>();
  for (const item of passages) {
    const text = item.heading ? `${item.heading}\n${item.text}` : item.text;
    for (const stem of tokenize(text)) {
      passageStems.add(stem);
    }
  }
  const uncoveredTerms: string[] = [];
  const seenStems = new Set<string>();
  for (const raw of query.split(/[^a-zA-Z0-9]+/)) {
    if (!raw) {
      continue;
    }
    // `tokenize` returns [] for stopwords / too-short tokens, else [stem].
    const [stem] = tokenize(raw);
    if (!stem || seenStems.has(stem)) {
      continue;
    }
    seenStems.add(stem);
    if (!passageStems.has(stem)) {
      uncoveredTerms.push(raw);
    }
  }

  const notes = new Set(passages.map((p) => p.path)).size;

  return {
    query,
    passages,
    citations,
    gaps: { weakCoverage, topScore, threshold, uncoveredTerms },
    coverage: { citations: citations.length, notes, topScore },
  };
}
