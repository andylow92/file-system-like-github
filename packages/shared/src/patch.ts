/**
 * Pure text-transform helpers for granular markdown edits.
 *
 * Agents often want to add to a note (append a task, prepend a status block) or
 * rewrite one section (replace the body under `## Tasks`) without rewriting the
 * whole file. These helpers keep the transform logic dependency-free and unit-
 * testable, so the API and MCP can layer concurrency, audit, and dry-run on top.
 */

import { findBlock, stripAnchor } from './blocks.js';
import { parseFrontmatter } from './markdown.js';

export type AppendOp = { type: 'append'; text: string };
export type PrependOp = { type: 'prepend'; text: string };
export type ReplaceSectionOp = { type: 'replace_section'; heading: string; body: string };
export type ReplaceBlockOp = { type: 'replace_block'; blockId: string; body: string };
export type PatchOp = AppendOp | PrependOp | ReplaceSectionOp | ReplaceBlockOp;
export type PatchOpType = PatchOp['type'];

export const PATCH_OP_TYPES: PatchOpType[] = [
  'append',
  'prepend',
  'replace_section',
  'replace_block',
];

export interface PatchResult {
  content: string;
  /** True when applying the op changed the content. */
  changed: boolean;
}

/**
 * Thrown when `replace_section` cannot find the requested heading. Surfaced as
 * a 404 by the API.
 */
export class SectionNotFoundError extends Error {
  constructor(public heading: string) {
    super(`Section heading not found: ${heading}`);
    this.name = 'SectionNotFoundError';
  }
}

/**
 * Thrown when `replace_block` cannot find an anchor for the requested block id.
 * Surfaced as a 404 by the API.
 */
export class BlockNotFoundError extends Error {
  constructor(public blockId: string) {
    super(`Block anchor not found: ^${blockId}`);
    this.name = 'BlockNotFoundError';
  }
}

/** Append `text` to the end of `content`, with exactly one separating newline. */
export function applyAppend(content: string, text: string): PatchResult {
  if (content.length === 0) {
    return { content: text, changed: text.length > 0 };
  }
  const separator = content.endsWith('\n') ? '' : '\n';
  const next = `${content}${separator}${text}`;
  return { content: next, changed: next !== content };
}

/**
 * Insert `text` at the start of `content`. If the note has a YAML frontmatter
 * block, the text lands AFTER the frontmatter so metadata stays at the top.
 */
export function applyPrepend(content: string, text: string): PatchResult {
  if (content.length === 0) {
    return { content: text, changed: text.length > 0 };
  }

  const separator = text.endsWith('\n') ? '' : '\n';
  const parsed = parseFrontmatter(content);

  if (!parsed.hasFrontmatter) {
    const next = `${text}${separator}${content}`;
    return { content: next, changed: next !== content };
  }

  const lines = content.split('\n');
  let frontmatterEnd = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---[ \t]*$/.test(lines[i])) {
      frontmatterEnd = i;
      break;
    }
  }
  if (frontmatterEnd === -1) {
    const next = `${text}${separator}${content}`;
    return { content: next, changed: next !== content };
  }

  const head = lines.slice(0, frontmatterEnd + 1).join('\n');
  const tail = lines.slice(frontmatterEnd + 1).join('\n');
  const next = `${head}\n${text}${separator}${tail}`;
  return { content: next, changed: next !== content };
}

const HEADING_PATTERN = /^(#{1,6})\s/;

/**
 * Replace the body under the first heading matching `heading` exactly. The
 * caller passes the full heading line (e.g. `"## Tasks"`); we use the leading
 * `#`s to know what level to stop at. The replacement body is inserted verbatim
 * between the heading and the next sibling-or-higher heading (or EOF).
 *
 * Throws `SectionNotFoundError` if the heading does not appear in `content`.
 */
export function replaceSection(content: string, heading: string, body: string): PatchResult {
  const trimmed = heading.trim();
  if (!trimmed) {
    throw new Error('Heading is required');
  }
  const levelMatch = trimmed.match(HEADING_PATTERN);
  if (!levelMatch) {
    throw new Error('Heading must start with 1-6 `#` characters followed by a space');
  }
  const level = levelMatch[1].length;

  const lines = content.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === trimmed) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    throw new SectionNotFoundError(heading);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const nextHeading = lines[i].match(HEADING_PATTERN);
    if (nextHeading && nextHeading[1].length <= level) {
      end = i;
      break;
    }
  }

  const bodyLines = body === '' ? [] : body.split('\n');
  const next = [...lines.slice(0, start + 1), ...bodyLines, ...lines.slice(end)].join('\n');
  return { content: next, changed: next !== content };
}

/**
 * Replace the block carrying `^blockId` with `body`. The block boundaries are
 * those returned by `findBlock` (paragraph / list-item / heading section). The
 * anchor is preserved at the end of the replacement's first line so future
 * reads can still address the block.
 *
 * Throws `BlockNotFoundError` when no such anchor exists. Operates on the body
 * (frontmatter is untouched).
 */
export function replaceBlock(content: string, blockId: string, body: string): PatchResult {
  if (!blockId.trim()) {
    throw new Error('Block id is required');
  }

  const parsed = parseFrontmatter(content);
  const found = findBlock(parsed.body, blockId);
  if (!found) {
    throw new BlockNotFoundError(blockId);
  }

  const bodyLines = parsed.body.split('\n');
  const replacementLines = body === '' ? [''] : body.split('\n');

  // Re-attach the anchor so the block stays addressable. If the caller already
  // included a trailing ` ^id`, leave it alone.
  const firstLine = replacementLines[0];
  if (!new RegExp(`[ \\t]+\\^${blockId}[ \\t]*$`).test(firstLine)) {
    const stripped = stripAnchor(firstLine).replace(/[ \t]+$/, '');
    replacementLines[0] = stripped.length > 0 ? `${stripped} ^${blockId}` : `^${blockId}`;
  }

  const startIdx = found.startLine - 1;
  const endIdx = found.endLine - 1;
  const nextBodyLines = [
    ...bodyLines.slice(0, startIdx),
    ...replacementLines,
    ...bodyLines.slice(endIdx + 1),
  ];

  const nextBody = nextBodyLines.join('\n');

  if (!parsed.hasFrontmatter) {
    return { content: nextBody, changed: nextBody !== content };
  }

  // Reattach the frontmatter block. We reconstruct from the original lines so
  // the exact frontmatter formatting is preserved.
  const originalLines = content.split('\n');
  let closingIndex = -1;
  for (let i = 1; i < originalLines.length; i += 1) {
    if (/^---[ \t]*$/.test(originalLines[i])) {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return { content: nextBody, changed: nextBody !== content };
  }
  // parseFrontmatter strips leading blank lines from the body; preserve that
  // separator by counting how many blanks sat between the closing fence and
  // the start of the recorded body.
  const head = originalLines.slice(0, closingIndex + 1).join('\n');
  let blanks = 0;
  for (let i = closingIndex + 1; i < originalLines.length; i += 1) {
    if (originalLines[i] === '') {
      blanks += 1;
    } else {
      break;
    }
  }
  const separator = `\n${'\n'.repeat(blanks)}`;
  const next = `${head}${separator}${nextBody}`;
  return { content: next, changed: next !== content };
}

/** Dispatch on a `PatchOp` discriminator to the matching transform. */
export function applyPatchOp(content: string, op: PatchOp): PatchResult {
  switch (op.type) {
    case 'append':
      return applyAppend(content, op.text);
    case 'prepend':
      return applyPrepend(content, op.text);
    case 'replace_section':
      return replaceSection(content, op.heading, op.body);
    case 'replace_block':
      return replaceBlock(content, op.blockId, op.body);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown patch op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
