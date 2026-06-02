/**
 * Stable note identity. A note's `id:` frontmatter survives renames and moves,
 * so agents can keep pointing at the same note without re-resolving paths.
 *
 * These helpers are deliberately explicit: nothing here mutates a note on read.
 * The API exposes an `ensure_id` path that adds an id when callers opt in.
 */
import { parseFrontmatter } from './markdown.js';

/**
 * Permitted characters in a note id. The id is spliced verbatim into a YAML
 * frontmatter line, so anything outside `[A-Za-z0-9-]` (e.g. newlines, `:`,
 * `---`, quotes) could break the block or inject sibling keys. Matches the
 * block-anchor pattern so the two id flavours stay consistent.
 */
const NOTE_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/** Extract the stable id from a note's frontmatter (the `id:` key). */
export function findNoteId(raw: string): string | undefined {
  const { frontmatter } = parseFrontmatter(raw);
  const value = frontmatter.id;
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return undefined;
}

/**
 * Ensure the note has an `id:` frontmatter entry. Returns the note unchanged
 * and `changed: false` if it already had one; otherwise inserts the id at the
 * top of the frontmatter (creating the block if there is none) and returns the
 * updated text with `changed: true`. Idempotent.
 *
 * The supplied `id` must match `[A-Za-z0-9-]+` — both to keep the YAML well-
 * formed (the id is spliced as a bare scalar) and to match the block-anchor
 * id shape, so a single charset describes every stable address in the vault.
 */
export function ensureNoteId(
  raw: string,
  id: string,
): { content: string; id: string; changed: boolean } {
  if (!id.trim()) {
    throw new Error('Note id cannot be empty');
  }
  if (!NOTE_ID_PATTERN.test(id)) {
    throw new Error('Note id must match [A-Za-z0-9-]+');
  }
  const existing = findNoteId(raw);
  if (existing) {
    return { content: raw, id: existing, changed: false };
  }

  const parsed = parseFrontmatter(raw);
  if (!parsed.hasFrontmatter) {
    const trimmed = raw.replace(/^\n+/, '');
    const newline = trimmed ? '\n' : '';
    const content = `---\nid: ${id}\n---\n${newline}${trimmed}`;
    return { content, id, changed: true };
  }

  const lines = raw.split('\n');
  // Inject after the opening `---` fence (line 0).
  lines.splice(1, 0, `id: ${id}`);
  return { content: lines.join('\n'), id, changed: true };
}
