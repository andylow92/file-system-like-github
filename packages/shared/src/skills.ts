/**
 * Pure helpers for **skill notes** — the vault's procedural memory.
 *
 * A skill note is an ordinary markdown note that declares `type: skill` in its
 * frontmatter and documents *how to perform a task*: the goal, the steps, the
 * gotchas. Humans write them like any other note; agents are nudged (via the
 * `list_skills` MCP tool description) to check for a relevant skill before
 * starting a task and to `propose_edit` a new or updated skill after learning
 * something reusable — so the vault's playbooks grow from real work, with every
 * addition passing human review.
 *
 * This module only *recognizes and summarizes* skill notes; it adds no storage
 * or write path. Reading a skill is just `read_note`, updating one is just
 * `propose_edit` — the convention rides entirely on existing infrastructure.
 */
import { parseNote } from './markdown.js';

/** The frontmatter `type:` value that marks a note as a skill. */
export const SKILL_TYPE = 'skill';

/** A listing entry for one skill note — enough to decide whether to read it. */
export interface SkillSummary {
  /** Logical path of the note (read it with `read_note` / `GET /api/file`). */
  path: string;
  /** Frontmatter `name:`, else the first `# heading`, else the filename. */
  name: string;
  /** Frontmatter `description:`, else the first body paragraph line. */
  description: string;
  /** Tags declared by the note. */
  tags: string[];
}

/** Body lines outside fenced code blocks, so a leading fence can't become a
 * skill's name or description. */
function visibleLines(body: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      lines.push(line);
    }
  }
  return lines;
}

function firstHeading(body: string): string | undefined {
  for (const line of visibleLines(body)) {
    const match = /^#{1,6}\s+(.+)$/.exec(line);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function firstParagraphLine(body: string): string {
  for (const raw of visibleLines(body)) {
    const line = raw.trim();
    if (line && !line.startsWith('#')) {
      return line.replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  return '';
}

/**
 * Parse a note into a {@link SkillSummary}, or `null` when the note does not
 * declare `type: skill` (matched case-insensitively) in its frontmatter.
 */
export function parseSkill(path: string, content: string): SkillSummary | null {
  const note = parseNote(content);
  const type = note.frontmatter['type'];
  if (typeof type !== 'string' || type.trim().toLowerCase() !== SKILL_TYPE) {
    return null;
  }

  const declaredName = note.frontmatter['name'];
  const fallbackName = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
  const name =
    (typeof declaredName === 'string' && declaredName.trim()) ||
    firstHeading(note.body) ||
    fallbackName;

  const declaredDescription = note.frontmatter['description'];
  const description =
    (typeof declaredDescription === 'string' && declaredDescription.trim()) ||
    firstParagraphLine(note.body);

  return { path, name, description, tags: note.tags };
}

/**
 * Collect every skill note in a corpus, optionally filtered by a
 * case-insensitive substring match over name, description, path, and tags.
 * Sorted by name (then path) for a stable listing.
 */
export function listSkills(
  documents: readonly { path: string; content: string }[],
  query?: string,
): SkillSummary[] {
  const needle = query?.trim().toLowerCase();
  const skills: SkillSummary[] = [];

  for (const { path, content } of documents) {
    const skill = parseSkill(path, content);
    if (!skill) {
      continue;
    }
    if (needle) {
      const haystack = [skill.name, skill.description, skill.path, ...skill.tags]
        .join('\n')
        .toLowerCase();
      if (!haystack.includes(needle)) {
        continue;
      }
    }
    skills.push(skill);
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
