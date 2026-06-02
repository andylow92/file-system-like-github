/**
 * Pure text-transform helpers for granular markdown edits.
 *
 * Agents often want to add to a note (append a task, prepend a status block) or
 * rewrite one section (replace the body under `## Tasks`) without rewriting the
 * whole file. These helpers keep the transform logic dependency-free and unit-
 * testable, so the API and MCP can layer concurrency, audit, and dry-run on top.
 */

import { parseFrontmatter } from './markdown.js';

export type AppendOp = { type: 'append'; text: string };
export type PrependOp = { type: 'prepend'; text: string };
export type ReplaceSectionOp = { type: 'replace_section'; heading: string; body: string };
export type PatchOp = AppendOp | PrependOp | ReplaceSectionOp;
export type PatchOpType = PatchOp['type'];

export const PATCH_OP_TYPES: PatchOpType[] = ['append', 'prepend', 'replace_section'];

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

/** Dispatch on a `PatchOp` discriminator to the matching transform. */
export function applyPatchOp(content: string, op: PatchOp): PatchResult {
  switch (op.type) {
    case 'append':
      return applyAppend(content, op.text);
    case 'prepend':
      return applyPrepend(content, op.text);
    case 'replace_section':
      return replaceSection(content, op.heading, op.body);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown patch op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
