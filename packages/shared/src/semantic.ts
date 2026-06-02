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
 * Rank note chunks by TF-IDF cosine similarity to `query`. The IDF is computed
 * over the chunk corpus on each call (fine for a local vault).
 */
export function semanticSearch(
  documents: SemanticDocument[],
  query: string,
  options: SemanticSearchOptions = {},
): SemanticHit[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  const chunks: NoteChunk[] = [];
  for (const doc of documents) {
    chunks.push(...chunkNote(doc.path, doc.content, options.chunkSize));
  }
  if (chunks.length === 0) {
    return [];
  }

  const chunkTokens = chunks.map((chunk) => tokenize(chunk.text));

  const documentFrequency = new Map<string, number>();
  for (const tokens of chunkTokens) {
    for (const term of new Set(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = chunks.length;
  const idf = (term: string) => Math.log(1 + total / ((documentFrequency.get(term) ?? 0) + 1));

  const queryVector = buildVector(queryTokens, idf);

  const scored = chunks.map((chunk, i) => ({
    chunk,
    score: cosine(queryVector, buildVector(chunkTokens[i], idf)),
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
      chunkIndex: entry.chunk.index,
      score: Number(entry.score.toFixed(4)),
      snippet: entry.chunk.text.replace(/\s+/g, ' ').trim().slice(0, 200),
    }));
}
