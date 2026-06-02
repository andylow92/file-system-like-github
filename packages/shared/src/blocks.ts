/**
 * Block anchors give agents a stable, Obsidian-compatible way to address a
 * specific paragraph / list-item / heading section inside a note. An anchor is
 * a trailing ` ^id` token on a line:
 *
 *     This paragraph carries an anchor. ^claim-1
 *
 *     - a list item ^todo-7
 *
 *     ## Section heading ^section-a
 *
 * Anchors inside fenced code (``` ``` ```) are ignored — they are content, not
 * markup. These helpers are pure + dependency-free so they can be tested in
 * isolation and shared by the API and MCP server.
 */
import { parseFrontmatter } from './markdown.js';

export interface BlockAnchor {
  id: string;
  /** 1-based line number of the anchored line within the body. */
  line: number;
  /** The line's text with the anchor token stripped. */
  text: string;
}

export interface BlockRange {
  /** 1-based start line within the body. */
  startLine: number;
  /** 1-based end line within the body (inclusive). */
  endLine: number;
  /** The block's lines joined with newlines, anchor token stripped. */
  text: string;
}

const ANCHOR_ID_PATTERN = /^[A-Za-z0-9-]+$/;
const TRAILING_ANCHOR = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const HEADING_PATTERN = /^(#{1,6})\s/;
const LIST_ITEM_PATTERN = /^(\s*)([-*+]|\d+[.)])\s/;
const CODE_FENCE = /^[ \t]*(```+|~~~+)/;

/** Mark lines that are inside a fenced code block so we can ignore anchors there. */
function markCodeFenceLines(lines: string[]): boolean[] {
  const inCode = new Array<boolean>(lines.length).fill(false);
  let openFence: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const match = CODE_FENCE.exec(lines[i]);
    if (match) {
      const fence = match[1];
      if (openFence === null) {
        openFence = fence[0]; // remember the fence char (` or ~)
        inCode[i] = true;
        continue;
      }
      // A fence of the same family or longer can close it.
      if (fence.startsWith(openFence)) {
        inCode[i] = true;
        openFence = null;
        continue;
      }
    }
    if (openFence !== null) {
      inCode[i] = true;
    }
  }

  return inCode;
}

/**
 * Strip a trailing ` ^id` token from a line, returning the cleaned line. Used
 * when callers want to show the block content without the anchor marker.
 */
export function stripAnchor(line: string): string {
  return line.replace(TRAILING_ANCHOR, '');
}

/** Find a trailing ` ^id` token on a single line (no code-fence context). */
function anchorOnLine(line: string): { id: string; text: string } | null {
  const match = TRAILING_ANCHOR.exec(line);
  if (!match) {
    return null;
  }
  return { id: match[1], text: line.slice(0, match.index) };
}

/**
 * Extract every `^id` block anchor from the body. Anchors inside fenced code
 * blocks are skipped. Lines are reported 1-based.
 */
export function extractBlockAnchors(body: string): BlockAnchor[] {
  const lines = body.split('\n');
  const inCode = markCodeFenceLines(lines);
  const anchors: BlockAnchor[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (inCode[i]) {
      continue;
    }
    const found = anchorOnLine(lines[i]);
    if (found) {
      anchors.push({ id: found.id, line: i + 1, text: found.text });
    }
  }

  return anchors;
}

/**
 * Find the block (paragraph / list-item / heading section) carrying anchor
 * `id`. Returns the inclusive line range within the body plus the block text
 * with the anchor token stripped, or `null` when no such anchor exists.
 *
 * Resolution rules:
 * - Heading line → block = the heading and everything under it up to the next
 *   sibling-or-higher heading (Obsidian's "anchor at heading" behaviour).
 * - List item → block = the item line and any indented continuation lines.
 * - Otherwise (paragraph) → block = the contiguous non-empty lines around the
 *   anchored line, stopping at blank lines.
 */
export function findBlock(body: string, id: string): BlockRange | null {
  const lines = body.split('\n');
  const inCode = markCodeFenceLines(lines);

  let anchorLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (inCode[i]) {
      continue;
    }
    const found = anchorOnLine(lines[i]);
    if (found && found.id === id) {
      anchorLine = i;
      break;
    }
  }
  if (anchorLine === -1) {
    return null;
  }

  const headingMatch = HEADING_PATTERN.exec(stripAnchor(lines[anchorLine]));
  if (headingMatch) {
    const level = headingMatch[1].length;
    let end = lines.length - 1;
    for (let i = anchorLine + 1; i < lines.length; i += 1) {
      const next = HEADING_PATTERN.exec(lines[i]);
      if (next && next[1].length <= level) {
        end = i - 1;
        break;
      }
    }
    return blockRange(lines, anchorLine, end);
  }

  const listMatch = LIST_ITEM_PATTERN.exec(stripAnchor(lines[anchorLine]));
  if (listMatch) {
    const indent = listMatch[1].length;
    let end = anchorLine;
    for (let i = anchorLine + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) {
        break;
      }
      const nextList = LIST_ITEM_PATTERN.exec(line);
      if (nextList && nextList[1].length <= indent) {
        break;
      }
      // Continuation lines must be indented past the marker.
      if (line.length - line.trimStart().length <= indent) {
        break;
      }
      end = i;
    }
    return blockRange(lines, anchorLine, end);
  }

  // Paragraph: walk outward to nearest blank lines.
  let start = anchorLine;
  while (start > 0 && lines[start - 1].trim() !== '') {
    start -= 1;
  }
  let end = anchorLine;
  while (end < lines.length - 1 && lines[end + 1].trim() !== '') {
    end += 1;
  }
  return blockRange(lines, start, end);
}

function blockRange(lines: string[], start: number, end: number): BlockRange {
  const text = lines
    .slice(start, end + 1)
    .map(stripAnchor)
    .join('\n');
  return { startLine: start + 1, endLine: end + 1, text };
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a short, URL-safe, ASCII block id. */
function generateBlockId(): string {
  let id = '';
  for (let i = 0; i < 8; i += 1) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return id;
}

export interface UpsertBlockAnchorOptions {
  /** Override the random id generator (used in tests for determinism). */
  generateId?: () => string;
}

/**
 * Ensure the body line at `line` (1-based, in body coordinates) carries a block
 * anchor. If `id` is supplied, that exact id is used; otherwise an existing
 * anchor on the line is preserved, or a short random id is generated when the
 * line has none. Returns the updated body and the resulting id. Idempotent.
 */
export function upsertBlockAnchor(
  body: string,
  id: string | undefined,
  line: number,
  options: UpsertBlockAnchorOptions = {},
): { body: string; id: string } {
  const lines = body.split('\n');
  if (line < 1 || line > lines.length) {
    throw new Error(`Line ${line} is out of range (1..${lines.length})`);
  }
  if (id !== undefined && !ANCHOR_ID_PATTERN.test(id)) {
    throw new Error('Anchor id must match [A-Za-z0-9-]+');
  }

  const idx = line - 1;
  const existing = anchorOnLine(lines[idx]);

  if (existing && (!id || existing.id === id)) {
    return { body, id: existing.id };
  }

  const finalId = id ?? options.generateId?.() ?? generateBlockId();
  const base = existing ? existing.text.replace(/[ \t]+$/, '') : lines[idx].replace(/[ \t]+$/, '');
  lines[idx] = base.length > 0 ? `${base} ^${finalId}` : `^${finalId}`;
  return { body: lines.join('\n'), id: finalId };
}

/**
 * Extract anchors from the *body* of a full document (frontmatter stripped).
 * Convenience wrapper for callers that work with the raw note text.
 */
export function extractBlockAnchorsFromNote(raw: string): BlockAnchor[] {
  const { body } = parseFrontmatter(raw);
  return extractBlockAnchors(body);
}
