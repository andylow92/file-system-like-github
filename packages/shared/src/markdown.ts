/**
 * Pure markdown utilities shared by the API and web app.
 *
 * Scope (Slice 1): frontmatter, `#tags`, and `[[wikilink]]` extraction +
 * resolution. These are deliberately small, dependency-free functions so they
 * can run in both the Node API and the browser, and be unit-tested in isolation.
 *
 * The frontmatter parser supports a minimal YAML subset only (scalar
 * `key: value`, inline `[a, b]` arrays, and block `- item` lists). It is not a
 * full YAML implementation.
 */

export interface WikiLink {
  /** Raw inner text exactly as written, e.g. `folder/Note#Heading|Alias`. */
  raw: string;
  /** Target without heading/alias, e.g. `folder/Note`. */
  target: string;
  /** Optional heading fragment after `#`. */
  heading?: string;
  /** Optional display alias after `|`. */
  alias?: string;
}

export interface ParsedFrontmatter {
  frontmatter: Record<string, string | string[]>;
  /** Document body with the frontmatter block removed. */
  body: string;
  hasFrontmatter: boolean;
}

export interface ParsedNote extends ParsedFrontmatter {
  tags: string[];
  links: WikiLink[];
}

const FRONTMATTER_FENCE = /^---[ \t]*$/;

/**
 * Split a single wikilink inner token (without the surrounding brackets) into
 * its target, optional heading, and optional alias.
 */
export function parseWikilinkToken(raw: string): WikiLink {
  const trimmed = raw.trim();
  const [beforeAlias, ...aliasRest] = trimmed.split('|');
  const alias = aliasRest.length > 0 ? aliasRest.join('|').trim() : undefined;

  const [target, ...headingRest] = beforeAlias.split('#');
  const heading = headingRest.length > 0 ? headingRest.join('#').trim() : undefined;

  return {
    raw: trimmed,
    target: target.trim(),
    ...(heading ? { heading } : {}),
    ...(alias ? { alias } : {}),
  };
}

/**
 * Remove fenced (``` ```) and inline (`` ` ``) code so tags/links inside code
 * are not extracted as real tags/links.
 */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/**
 * Parse a leading YAML frontmatter block (minimal subset). Returns the document
 * body with the block removed when present.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const lines = raw.split('\n');

  if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0])) {
    return { frontmatter: {}, body: raw, hasFrontmatter: false };
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (FRONTMATTER_FENCE.test(lines[i])) {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    // No closing fence — treat the whole document as body.
    return { frontmatter: {}, body: raw, hasFrontmatter: false };
  }

  const frontmatter: Record<string, string | string[]> = {};
  let pendingListKey: string | null = null;

  for (let i = 1; i < closingIndex; i += 1) {
    const line = lines[i];

    const listItem = line.match(/^[ \t]*-[ \t]+(.*)$/);
    if (pendingListKey && listItem) {
      const arr = frontmatter[pendingListKey];
      const value = stripQuotes(listItem[1].trim());
      if (Array.isArray(arr)) {
        arr.push(value);
      } else {
        frontmatter[pendingListKey] = [value];
      }
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!kv) {
      continue;
    }

    const key = kv[1];
    const rawValue = kv[2].trim();
    pendingListKey = null;

    if (rawValue === '') {
      // Could be the start of a block list on following lines.
      frontmatter[key] = [];
      pendingListKey = key;
      continue;
    }

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      frontmatter[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((part) => stripQuotes(part.trim()))
        .filter((part) => part.length > 0);
      continue;
    }

    frontmatter[key] = stripQuotes(rawValue);
  }

  // Drop empty block-list placeholders that never received items.
  for (const key of Object.keys(frontmatter)) {
    const value = frontmatter[key];
    if (Array.isArray(value) && value.length === 0) {
      delete frontmatter[key];
    }
  }

  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .replace(/^\n+/, '');
  return { frontmatter, body, hasFrontmatter: true };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Extract all `[[wikilinks]]` from the given text (code stripped first). */
export function extractWikilinks(text: string): WikiLink[] {
  const source = stripCode(text);
  const matches = source.matchAll(/\[\[([^\]\n]+)\]\]/g);
  const links: WikiLink[] = [];

  for (const match of matches) {
    const inner = match[1];
    if (inner.trim()) {
      links.push(parseWikilinkToken(inner));
    }
  }

  return links;
}

/**
 * Extract tags from inline `#tag` syntax in the body, merged with any `tags`
 * field from frontmatter. Returns a de-duplicated, order-preserving list of tag
 * names without the leading `#`.
 */
export function extractTags(raw: string): string[] {
  const { frontmatter, body } = parseFrontmatter(raw);
  const tags: string[] = [];

  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    tags.push(...fmTags);
  } else if (typeof fmTags === 'string') {
    tags.push(
      ...fmTags
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }

  const source = stripCode(body);
  for (const match of source.matchAll(/(?:^|[\s(])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g)) {
    tags.push(match[1]);
  }

  return [...new Set(tags.map((tag) => tag.replace(/^#/, '')).filter(Boolean))];
}

/** Parse a markdown document into frontmatter, body, tags, and wikilinks. */
export function parseNote(raw: string): ParsedNote {
  const parsed = parseFrontmatter(raw);
  return {
    ...parsed,
    tags: extractTags(raw),
    links: extractWikilinks(parsed.body),
  };
}

/**
 * Resolve a wikilink target against a set of known logical file paths
 * (e.g. `folder/Note.md`).
 *
 * Resolution order: exact path match → exact path + `.md` → basename match
 * (filename without extension equals the last segment of the target). Matching
 * is case-insensitive; basename ties resolve to the first path in sorted order
 * for determinism.
 */
export function resolveWikilink(target: string, allPaths: string[]): string | null {
  const cleaned = target.replace(/^\.\//, '').trim();
  if (!cleaned) {
    return null;
  }

  const lower = cleaned.toLowerCase();
  const withMd = lower.endsWith('.md') ? lower : `${lower}.md`;
  const wantedBase = (cleaned.split('/').pop() ?? cleaned).replace(/\.md$/i, '').toLowerCase();

  let basenameMatch: string | null = null;

  for (const candidate of [...allPaths].sort((a, b) => a.localeCompare(b))) {
    const candidateLower = candidate.toLowerCase();
    if (candidateLower === lower || candidateLower === withMd) {
      return candidate;
    }

    const candidateBase = (candidate.split('/').pop() ?? candidate)
      .replace(/\.md$/i, '')
      .toLowerCase();
    if (basenameMatch === null && candidateBase === wantedBase) {
      basenameMatch = candidate;
    }
  }

  return basenameMatch;
}
