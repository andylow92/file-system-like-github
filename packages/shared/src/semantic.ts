/**
 * Local, dependency-free semantic-ish retrieval for the vault.
 *
 * This ranks note *chunks* against a query using TF-IDF cosine similarity, so
 * results are about relevance (which passages are most "about" the query)
 * rather than exact substring matches. It runs anywhere, needs no model or API
 * key, and is deterministic — which is why it is the default engine.
 *
 * It is intentionally structured so a future embedding-based engine (a remote
 * `/v1/embeddings` provider or an on-device model) can replace `semanticSearch`
 * without touching callers: same `documents → SemanticHit[]` contract.
 */
import { parseFrontmatter } from './markdown.js';

export interface SemanticDocument {
  path: string;
  content: string;
}

export interface NoteChunk {
  path: string;
  /** 0-based chunk index within the note. */
  index: number;
  /** Nearest preceding heading, when the chunk sits under one. */
  heading?: string;
  text: string;
}

export interface SemanticHit {
  path: string;
  heading?: string;
  /** A short excerpt of the matched chunk. */
  snippet: string;
  /** Cosine similarity in [0, 1]; higher is more relevant. */
  score: number;
  chunkIndex: number;
}

export interface SemanticSearchOptions {
  limit?: number;
  /** Minimum cosine score to include (filters near-zero noise). */
  minScore?: number;
  /** Target chunk size in characters. */
  chunkSize?: number;
}

// A small English stopword list — enough to stop common words from dominating
// the ranking without needing a linguistics dependency.
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'so',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'which',
  'who',
  'will',
  'with',
  'you',
  'your',
  'we',
  'our',
  'can',
  'do',
  'does',
]);

/** A light suffix stemmer so `felines`/`feline` and `pets`/`pet` match. */
function stem(token: string): string {
  let result = token;
  if (result.length > 5 && result.endsWith('ing')) {
    result = result.slice(0, -3);
  } else if (result.length > 4 && result.endsWith('ed')) {
    result = result.slice(0, -2);
  }
  if (result.length > 3 && result.endsWith('s') && !result.endsWith('ss')) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Lowercase, strip inline code, split on non-alphanumerics, drop stopwords and
 * very short tokens, and apply light stemming.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
    .map(stem);
}

/**
 * Split a note's body (frontmatter removed) into chunks, grouping paragraphs
 * under their nearest heading and capping each chunk near `maxChars`.
 */
export function chunkNote(path: string, content: string, maxChars = 600): NoteChunk[] {
  const { body } = parseFrontmatter(content);
  const chunks: NoteChunk[] = [];
  let heading: string | undefined;
  let buffer: string[] = [];
  let length = 0;
  let index = 0;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      chunks.push(
        heading ? { path, index: index++, heading, text } : { path, index: index++, text },
      );
    }
    buffer = [];
    length = 0;
  };

  for (const line of body.split('\n')) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      heading = headingMatch[2].trim();
      continue;
    }

    if (!line.trim()) {
      if (length >= maxChars) {
        flush();
      }
      continue;
    }

    buffer.push(line);
    length += line.length + 1;
    if (length >= maxChars) {
      flush();
    }
  }

  flush();
  return chunks;
}

function buildVector(tokens: string[], idf: (term: string) => number): Map<string, number> {
  const termFrequency = new Map<string, number>();
  for (const token of tokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  const vector = new Map<string, number>();
  let norm = 0;
  for (const [term, count] of termFrequency) {
    const weight = (1 + Math.log(count)) * idf(term);
    vector.set(term, weight);
    norm += weight * weight;
  }

  const magnitude = Math.sqrt(norm) || 1;
  for (const [term, weight] of vector) {
    vector.set(term, weight / magnitude);
  }
  return vector;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) {
      dot += weight * other;
    }
  }
  return dot;
}

/**
 * A reusable, pre-computed ranking index over a document corpus: every note is
 * chunked once, each chunk's normalized TF-IDF vector is built once, and the IDF
 * is fixed for the corpus. Build it once and query it many times — only the
 * query side runs per call. Rebuild it when the corpus changes (see the API's
 * cached `VaultIndex`).
 */
export interface SemanticIndex {
  chunks: NoteChunk[];
  /** Per-chunk normalized TF-IDF vector, parallel to `chunks`. */
  vectors: Map<string, number>[];
  /** Inverse document frequency over the chunk corpus. */
  idf: (term: string) => number;
}

/** A ranked chunk carrying its full text (not just a display snippet). */
export interface RankedChunk {
  path: string;
  heading?: string;
  /** Full chunk text. */
  text: string;
  /** Cosine similarity in [0, 1], rounded to 4dp. */
  score: number;
  /** 0-based chunk index within its note. */
  chunkIndex: number;
}

export interface RankQueryOptions {
  limit?: number;
  /** Minimum cosine score to include (filters near-zero noise). */
  minScore?: number;
}

/**
 * Build a `SemanticIndex` from a corpus: chunk every note, compute the IDF over
 * the chunk corpus once, and pre-compute each chunk's TF-IDF vector. This is the
 * expensive part — done once and reused across queries.
 */
export function buildSemanticIndex(
  documents: SemanticDocument[],
  options: { chunkSize?: number } = {},
): SemanticIndex {
  const chunks: NoteChunk[] = [];
  for (const doc of documents) {
    chunks.push(...chunkNote(doc.path, doc.content, options.chunkSize));
  }

  // Include the chunk's heading in its ranked tokens (the heading is a strong
  // relevance signal) while keeping `chunk.text` clean for the display snippet.
  const chunkTokens = chunks.map((chunk) =>
    tokenize(chunk.heading ? `${chunk.heading}\n${chunk.text}` : chunk.text),
  );

  const documentFrequency = new Map<string, number>();
  for (const tokens of chunkTokens) {
    for (const term of new Set(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = chunks.length;
  const idf = (term: string) => Math.log(1 + total / ((documentFrequency.get(term) ?? 0) + 1));

  const vectors = chunkTokens.map((tokens) => buildVector(tokens, idf));

  return { chunks, vectors, idf };
}

/**
 * Rank a pre-built index's chunks against `query`, returning full chunk text.
 * Only the query vector is built per call; the chunk vectors and IDF are reused.
 */
export function queryRankedChunks(
  index: SemanticIndex,
  query: string,
  options: RankQueryOptions = {},
): RankedChunk[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || index.chunks.length === 0) {
    return [];
  }

  const queryVector = buildVector(queryTokens, index.idf);

  const scored = index.chunks.map((chunk, i) => ({
    chunk,
    score: cosine(queryVector, index.vectors[i]),
  }));

  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? 0.01;

  return scored
    .filter((entry) => entry.score > minScore)
    .sort((a, b) => b.score - a.score || a.chunk.path.localeCompare(b.chunk.path))
    .slice(0, limit)
    .map((entry) => ({
      path: entry.chunk.path,
      ...(entry.chunk.heading ? { heading: entry.chunk.heading } : {}),
      text: entry.chunk.text,
      score: Number(entry.score.toFixed(4)),
      chunkIndex: entry.chunk.index,
    }));
}

/** Project ranked chunks to the `SemanticHit` shape (a trimmed display snippet). */
export function querySemanticIndex(
  index: SemanticIndex,
  query: string,
  options: RankQueryOptions = {},
): SemanticHit[] {
  return queryRankedChunks(index, query, options).map((chunk) => ({
    path: chunk.path,
    ...(chunk.heading ? { heading: chunk.heading } : {}),
    chunkIndex: chunk.chunkIndex,
    score: chunk.score,
    snippet: chunk.text.replace(/\s+/g, ' ').trim().slice(0, 200),
  }));
}

/**
 * Rank note chunks by TF-IDF cosine similarity to `query`. Convenience wrapper
 * that builds a one-shot index and queries it — equivalent to
 * `querySemanticIndex(buildSemanticIndex(documents), query)`. Callers that query
 * the same corpus repeatedly should build the index once and reuse it.
 */
export function semanticSearch(
  documents: SemanticDocument[],
  query: string,
  options: SemanticSearchOptions = {},
): SemanticHit[] {
  if (tokenize(query).length === 0) {
    return [];
  }
  const index = buildSemanticIndex(documents, { chunkSize: options.chunkSize });
  return querySemanticIndex(index, query, { limit: options.limit, minScore: options.minScore });
}
