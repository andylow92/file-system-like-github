/**
 * Pure, dependency-free full-text search helpers shared across the API and any
 * other consumer. The matching is intentionally simple (case-insensitive
 * substring) so it can run anywhere without an index.
 */

export interface TextMatch {
  /** 1-based line number of the first match. */
  line: number;
  /** A short excerpt of the first matching line, centered on the match. */
  snippet: string;
  /** Total number of occurrences across the text. */
  count: number;
}

/** Build a trimmed, single-line excerpt of `line` centered on `query`. */
export function buildSnippet(line: string, query: string, maxLength = 160): string {
  const collapsed = line.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  const lower = collapsed.toLowerCase();
  const matchIndex = lower.indexOf(query.toLowerCase());
  if (matchIndex === -1) {
    return `${collapsed.slice(0, maxLength - 1)}…`;
  }

  const half = Math.floor((maxLength - query.length) / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(collapsed.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < collapsed.length ? '…' : '';
  return `${prefix}${collapsed.slice(start, end)}${suffix}`;
}

/**
 * Find the first case-insensitive substring match of `query` in `content` and
 * count total occurrences. Returns `null` when the query is empty or absent.
 */
export function findTextMatch(content: string, query: string): TextMatch | null {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return null;
  }

  const lines = content.split('\n');
  let firstLine = -1;
  let firstSnippet = '';
  let count = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    let index = lower.indexOf(needle);
    if (index === -1) {
      continue;
    }

    while (index !== -1) {
      count += 1;
      index = lower.indexOf(needle, index + needle.length);
    }

    if (firstLine === -1) {
      firstLine = i + 1;
      firstSnippet = buildSnippet(lines[i], needle);
    }
  }

  if (firstLine === -1) {
    return null;
  }

  return { line: firstLine, snippet: firstSnippet, count };
}
