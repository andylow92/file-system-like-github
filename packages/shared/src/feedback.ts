/**
 * Pure, deterministic **outreach feedback loop** — the offline core of the
 * vault's "learn from human review" cycle. It compares an agent's *draft* of a
 * piece of outreach (an X post, a LinkedIn message, an email) with the
 * human-approved *final* version, distills the difference into a concise lesson,
 * and attaches a **safe, reversible** suggestion that maps 1:1 onto an edit
 * proposal a human approves in the Review tab. Like the maintenance scan, it
 * never writes anything itself.
 *
 * The high-value signal is the *diff between draft and final*: what the human
 * removed, what they added, how much shorter it got, and (when recorded) why.
 * Today that signal evaporates the moment a post ships; this captures it as a
 * growing, human-audited playbook.
 *
 * ### The linking convention
 *
 * A **feedback pairing** is an ordinary note whose frontmatter declares
 * `type: feedback` plus, at minimum, a channel and the two artifacts to compare:
 *
 * ```yaml
 * ---
 * type: feedback
 * channel: x                              # x | linkedin | email
 * draftPath: social/x/drafts/launch.md    # the agent's first draft
 * finalPath: social/x/old-posts/launch.md # the approved / sent version
 * targetPath: social/x/post-patterns.md   # optional — playbook to grow
 * reviewReason: Too salesy; lead with customer pain.   # optional human note
 * ---
 * ```
 *
 * When `targetPath` is omitted the lesson lands in a per-channel playbook the
 * loop maintains at `feedback/<channel>.md` (created as a `type: skill` note, so
 * it slots straight into the skill library). The body of the pairing note is
 * ignored — the draft and final live in their own notes.
 *
 * ### Determinism & idempotency
 *
 * Everything here is pure + dependency-free (same documents in, same findings
 * out) so it unit-tests in isolation and a scheduled scan can never drift. Each
 * lesson carries a hidden, stable marker (`<!-- feedback-loop:draft->final -->`);
 * a pairing whose marker already appears in its target playbook is treated as
 * *already learned* and produces no finding, so re-running — even after a lesson
 * has been approved and appended — never duplicates it. The marker is keyed on
 * the `(draftPath, finalPath)` pair: drafts and finals are treated as immutable
 * artifacts, so editing one *in place* (same path, new text) will not re-trigger
 * learning — record a fresh draft/final pair to capture a new revision.
 *
 * Out of scope (deliberately): any LLM-written "rule". Inferring a natural-language
 * rule from a single before/after needs a model, which would break the offline
 * guarantee; the lesson here is an honest, mechanical diff summary plus the
 * human's own stated reason. A model-backed paraphrase belongs behind the same
 * server-side key gate that `think`'s synthesis uses, not here.
 */
import { parseFrontmatter } from './markdown.js';

/** The outreach channels the feedback loop understands. */
export type FeedbackChannel = 'x' | 'linkedin' | 'email';

/** The frontmatter `type:` value that marks a note as a feedback pairing. */
export const FEEDBACK_TYPE = 'feedback';

/** Channels accepted in a pairing's `channel:` field. */
export const FEEDBACK_CHANNELS: readonly FeedbackChannel[] = ['x', 'linkedin', 'email'];

/** Human-readable channel label, used in playbook titles and lesson headers. */
const CHANNEL_LABEL: Record<FeedbackChannel, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  email: 'Email',
};

/** A parsed feedback pairing: the two artifacts to compare and where to learn. */
export interface FeedbackPairing {
  /** Logical path of the pairing note itself. */
  pairPath: string;
  channel: FeedbackChannel;
  /** Logical path of the agent's draft note. */
  draftPath: string;
  /** Logical path of the human-approved / sent note. */
  finalPath: string;
  /** Playbook to grow; defaults to `feedback/<channel>.md` when unset. */
  targetPath: string;
  /** Optional human note on why the draft was changed/rejected. */
  reviewReason?: string;
}

/** The mechanical diff between a draft and its final version. */
export interface FeedbackDiff {
  draftWords: number;
  finalWords: number;
  /** `finalWords - draftWords` (negative = trimmed). */
  wordDelta: number;
  /** Draft segments absent from the final (capped, original casing). */
  removed: string[];
  /** Final segments absent from the draft (capped, original casing). */
  added: string[];
}

/**
 * A safe, reversible fix for a finding, shaped to map 1:1 onto an edit proposal
 * (the same `{ action, path, content?, note }` a human reviews). Only `create`
 * (a fresh per-channel playbook) and `update` (append a lesson) are ever
 * suggested — never a `delete`, so approving one can never lose content.
 */
export interface FeedbackSuggestion {
  action: 'create' | 'update';
  /** The playbook the lesson is filed against. */
  path: string;
  /** Full proposed content — a new playbook, or the target with the lesson appended. */
  content: string;
  /** Rationale carried onto the proposal. */
  note: string;
}

/** A single draft→final comparison, optionally with a one-click proposal fix. */
export interface FeedbackFinding {
  channel: FeedbackChannel;
  /** The pairing note that declared this comparison. */
  pairPath: string;
  draftPath: string;
  finalPath: string;
  /** Playbook the lesson targets. */
  targetPath: string;
  /** Concise human-readable summary of what changed (or why nothing was learned). */
  detail: string;
  /** The markdown lesson block proposed for the playbook (empty when report-only). */
  lesson: string;
  /** Echoed human review note, when the pairing recorded one. */
  reviewReason?: string;
  /** A safe, reversible proposal suggestion; absent when there is nothing to file. */
  suggestion?: FeedbackSuggestion;
}

export interface ScanFeedbackOptions {
  /** Max removed/added example segments kept per lesson (default 5). */
  maxSegments?: number;
}

/** A note to scan (the cached index's `{ path, content }` shape). */
export interface FeedbackDocument {
  path: string;
  content: string;
}

const DEFAULT_MAX_SEGMENTS = 5;
const SEGMENT_DISPLAY_CAP = 160;

/** Display label for a note path: the basename without the `.md` extension. */
function labelOf(notePath: string): string {
  const base = notePath.split('/').pop() ?? notePath;
  return base.replace(/\.md$/i, '');
}

/** Ensure a logical path carries a `.md` extension. */
function withMd(notePath: string): string {
  return /\.md$/i.test(notePath) ? notePath : `${notePath}.md`;
}

/** The default per-channel playbook a lesson lands in when none is specified. */
export function defaultTargetFor(channel: FeedbackChannel): string {
  return `feedback/${channel}.md`;
}

/** The hidden, stable marker that makes a learned lesson idempotent. */
export function feedbackMarker(draftPath: string, finalPath: string): string {
  return `<!-- feedback-loop:${draftPath}->${finalPath} -->`;
}

function asString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Parse a note into a {@link FeedbackPairing}, or `null` when it is not a valid
 * pairing (missing `type: feedback`, an unknown `channel`, or no draft/final).
 */
export function parseFeedbackPairing(notePath: string, content: string): FeedbackPairing | null {
  const { frontmatter } = parseFrontmatter(content);

  const type = asString(frontmatter['type']);
  if (!type || type.toLowerCase() !== FEEDBACK_TYPE) {
    return null;
  }

  const channelRaw = asString(frontmatter['channel'])?.toLowerCase();
  const channel = FEEDBACK_CHANNELS.find((candidate) => candidate === channelRaw);
  if (!channel) {
    return null;
  }

  const draftPath = asString(frontmatter['draftPath']);
  const finalPath = asString(frontmatter['finalPath']);
  if (!draftPath || !finalPath) {
    return null;
  }

  const targetPath = asString(frontmatter['targetPath']);
  const reviewReason = asString(frontmatter['reviewReason']);

  return {
    pairPath: notePath,
    channel,
    draftPath,
    finalPath,
    targetPath: targetPath ? withMd(targetPath) : defaultTargetFor(channel),
    ...(reviewReason ? { reviewReason } : {}),
  };
}

/** Count whitespace-delimited words. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Break body text into comparable segments: one per line, each further split on
 * sentence punctuation, normalized to single-spaced and trimmed.
 */
function segment(body: string): string[] {
  return body
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Truncate an example segment for a compact lesson line. */
function clip(text: string): string {
  return text.length > SEGMENT_DISPLAY_CAP ? `${text.slice(0, SEGMENT_DISPLAY_CAP - 1)}…` : text;
}

/**
 * Compute the mechanical diff between a draft and a final note (frontmatter
 * stripped from each). `removed`/`added` are the segments unique to one side,
 * compared case-insensitively but displayed in their original casing and capped
 * to `maxSegments`.
 */
export function diffDraftFinal(
  draftContent: string,
  finalContent: string,
  maxSegments: number = DEFAULT_MAX_SEGMENTS,
): FeedbackDiff {
  const draftBody = parseFrontmatter(draftContent).body;
  const finalBody = parseFrontmatter(finalContent).body;

  const draftSegments = segment(draftBody);
  const finalSegments = segment(finalBody);
  const draftKeys = new Set(draftSegments.map((part) => part.toLowerCase()));
  const finalKeys = new Set(finalSegments.map((part) => part.toLowerCase()));

  const removed = draftSegments
    .filter((part) => !finalKeys.has(part.toLowerCase()))
    .slice(0, maxSegments)
    .map(clip);
  const added = finalSegments
    .filter((part) => !draftKeys.has(part.toLowerCase()))
    .slice(0, maxSegments)
    .map(clip);

  const draftWords = countWords(draftBody);
  const finalWords = countWords(finalBody);

  return { draftWords, finalWords, wordDelta: finalWords - draftWords, removed, added };
}

/** Signed word-delta label, e.g. `+4`, `-21`, `0`. */
function deltaLabel(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

/**
 * Render a compact, deterministic lesson block for a pairing's diff. Carries the
 * idempotency marker as a trailing HTML comment so a re-scan can detect that the
 * lesson has already been learned.
 */
export function formatLesson(pairing: FeedbackPairing, diff: FeedbackDiff): string {
  const lines = [
    `### Review feedback · ${CHANNEL_LABEL[pairing.channel]}`,
    '',
    `- Source: draft [[${labelOf(pairing.draftPath)}]] → final [[${labelOf(pairing.finalPath)}]]`,
    `- Length: ${diff.draftWords} → ${diff.finalWords} words (${deltaLabel(diff.wordDelta)})`,
  ];
  if (diff.removed.length) {
    lines.push(`- Removed: ${diff.removed.map((part) => `"${part}"`).join('; ')}`);
  }
  if (diff.added.length) {
    lines.push(`- Added: ${diff.added.map((part) => `"${part}"`).join('; ')}`);
  }
  if (pairing.reviewReason) {
    lines.push(`- Human note: ${pairing.reviewReason}`);
  }
  lines.push('', feedbackMarker(pairing.draftPath, pairing.finalPath));
  return lines.join('\n');
}

/** A fresh per-channel playbook, seeded with its first lesson (a `type: skill` note). */
function newPlaybook(channel: FeedbackChannel, lesson: string): string {
  const label = CHANNEL_LABEL[channel];
  return [
    '---',
    'type: skill',
    `name: ${label} outreach playbook`,
    `description: Lessons distilled from reviewed ${label} drafts vs. final sent copy.`,
    `tags: [feedback, ${channel}]`,
    '---',
    `# ${label} outreach playbook`,
    '',
    `Patterns learned by comparing agent drafts with the human-approved ${label} copy that`,
    'actually shipped. Each entry below was filed by `agent:feedback-loop` and approved in review.',
    '',
    lesson,
    '',
  ].join('\n');
}

/** Append a lesson to an existing playbook, keeping one trailing newline. */
function appendLesson(content: string, lesson: string): string {
  return `${content.replace(/\s+$/, '')}\n\n${lesson}\n`;
}

/** Resolve a logical path against the corpus, tolerating a missing `.md`. */
function resolve(contentByPath: Map<string, string>, notePath: string): string | undefined {
  if (contentByPath.has(notePath)) {
    return notePath;
  }
  const md = withMd(notePath);
  return contentByPath.has(md) ? md : undefined;
}

/** Total order over findings so the same corpus always yields the same list. */
function sortFindings(findings: FeedbackFinding[]): FeedbackFinding[] {
  return [...findings].sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) ||
      a.pairPath.localeCompare(b.pairPath) ||
      a.draftPath.localeCompare(b.draftPath),
  );
}

/**
 * Scan a corpus for feedback pairings and return a deterministic, stably-ordered
 * list of draft→final findings. Pure: no I/O, no model, no mutation.
 *
 * A pairing yields:
 * - a finding **with** a `create`/`update` suggestion when the draft and final
 *   differ and the lesson is not already in the target playbook;
 * - a **report-only** finding (no suggestion) when a draft/final note is missing
 *   from the corpus, or the final is identical to the draft (nothing to learn);
 * - **no** finding at all when the lesson's marker is already present in the
 *   target (already learned), so repeated scans stay quiet.
 */
export function scanFeedback(
  documents: readonly FeedbackDocument[],
  options: ScanFeedbackOptions = {},
): FeedbackFinding[] {
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const contentByPath = new Map(documents.map((doc) => [doc.path, doc.content]));
  const findings: FeedbackFinding[] = [];

  for (const doc of documents) {
    const pairing = parseFeedbackPairing(doc.path, doc.content);
    if (!pairing) {
      continue;
    }

    const base = {
      channel: pairing.channel,
      pairPath: pairing.pairPath,
      draftPath: pairing.draftPath,
      finalPath: pairing.finalPath,
      targetPath: pairing.targetPath,
      lesson: '',
      ...(pairing.reviewReason ? { reviewReason: pairing.reviewReason } : {}),
    };

    const draftKey = resolve(contentByPath, pairing.draftPath);
    const finalKey = resolve(contentByPath, pairing.finalPath);
    if (!draftKey || !finalKey) {
      const missing = [!draftKey ? pairing.draftPath : null, !finalKey ? pairing.finalPath : null]
        .filter(Boolean)
        .join(' and ');
      findings.push({ ...base, detail: `Draft/final note not found: ${missing}.` });
      continue;
    }

    const diff = diffDraftFinal(
      contentByPath.get(draftKey)!,
      contentByPath.get(finalKey)!,
      maxSegments,
    );
    if (diff.removed.length === 0 && diff.added.length === 0 && diff.wordDelta === 0) {
      findings.push({
        ...base,
        detail: `Final matches the draft for "${labelOf(pairing.finalPath)}" — nothing to learn.`,
      });
      continue;
    }

    const targetKey = resolve(contentByPath, pairing.targetPath);
    const targetContent = targetKey ? contentByPath.get(targetKey)! : undefined;
    const marker = feedbackMarker(pairing.draftPath, pairing.finalPath);
    if (targetContent && targetContent.includes(marker)) {
      continue; // already learned — stay quiet on re-scan
    }

    const lesson = formatLesson(pairing, diff);
    const detail =
      `${CHANNEL_LABEL[pairing.channel]} draft → final: ${diff.draftWords}→${diff.finalWords} words ` +
      `(${deltaLabel(diff.wordDelta)}), ${diff.removed.length} removed / ${diff.added.length} added` +
      `${pairing.reviewReason ? `; reason noted` : ''}.`;
    const note =
      `Lesson from reviewed ${CHANNEL_LABEL[pairing.channel]} outreach: draft ${pairing.draftPath} ` +
      `vs final ${pairing.finalPath}${pairing.reviewReason ? ` — ${pairing.reviewReason}` : ''}.`;

    findings.push({
      ...base,
      detail,
      lesson,
      suggestion: targetContent
        ? { action: 'update', path: targetKey!, content: appendLesson(targetContent, lesson), note }
        : {
            action: 'create',
            // `parseFeedbackPairing` already normalized targetPath to end in `.md`.
            path: pairing.targetPath,
            content: newPlaybook(pairing.channel, lesson),
            note,
          },
    });
  }

  return sortFindings(findings);
}
