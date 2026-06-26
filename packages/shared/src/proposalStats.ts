/**
 * Pure helpers for **review-queue learning** — the vault reading its own
 * approve/reject history instead of discarding it.
 *
 * Every agent-proposed edit already records an outcome (`status` flips to
 * `approved` / `rejected` when the human resolves it in the Review tab), but
 * nothing ever reads that signal back. These helpers distill the proposal
 * store into per-category **approval rates** and, from them, a **bounded,
 * guarded threshold nudge** — so a scan that keeps getting its suggestions
 * rejected can quietly get more conservative, and one that's always approved
 * can get more aggressive. The human stays the gate; only the *propensity to
 * propose* tunes.
 *
 * Deterministic and dependency-free, like the rest of `@repo/shared`: same
 * proposals in, same stats out. It takes a structural {@link ProposalRecord}
 * (the fields it needs, not the full `EditProposal`) so it stays decoupled and
 * unit-tests in isolation.
 */

/** The review outcomes a proposal can carry. */
export type ProposalDecision = 'pending' | 'approved' | 'rejected';

/** The minimal slice of a proposal the stats need. */
export interface ProposalRecord {
  /** Who proposed it, e.g. `agent:maintenance`. */
  actor: string;
  /** The edit kind. */
  action: 'create' | 'update' | 'delete';
  /** Current review status. */
  status: ProposalDecision;
  /** Optional grouping key set by the filer; falls back to `actor:action`. */
  category?: string;
}

/** Approve/reject tallies for one proposal category. */
export interface CategoryStat {
  /** The grouping key (explicit `category`, else `actor:action`). */
  category: string;
  approved: number;
  rejected: number;
  pending: number;
  /** `approved + rejected` — the sample the rate is computed over. */
  resolved: number;
  /** All proposals in this category, resolved or not. */
  total: number;
  /**
   * `approved / resolved`, rounded to 4dp, or `null` when nothing in the
   * category has been resolved yet (no signal to learn from).
   */
  approvalRate: number | null;
}

/** The category key for a proposal: explicit `category`, else `actor:action`. */
export function categoryOf(proposal: ProposalRecord): string {
  const explicit = proposal.category?.trim();
  return explicit ? explicit : `${proposal.actor}:${proposal.action}`;
}

/**
 * Tally approve/reject outcomes per category across the proposal store.
 * Categories are sorted by resolved count desc, then total desc, then category
 * name asc — a total order, so the same store always yields the same list.
 */
export function summarizeOutcomes(proposals: readonly ProposalRecord[]): CategoryStat[] {
  const byCategory = new Map<string, CategoryStat>();

  for (const proposal of proposals) {
    const category = categoryOf(proposal);
    const stat =
      byCategory.get(category) ??
      ({
        category,
        approved: 0,
        rejected: 0,
        pending: 0,
        resolved: 0,
        total: 0,
        approvalRate: null,
      } as CategoryStat);

    stat.total += 1;
    if (proposal.status === 'approved') {
      stat.approved += 1;
    } else if (proposal.status === 'rejected') {
      stat.rejected += 1;
    } else {
      stat.pending += 1;
    }
    byCategory.set(category, stat);
  }

  for (const stat of byCategory.values()) {
    stat.resolved = stat.approved + stat.rejected;
    stat.approvalRate =
      stat.resolved === 0 ? null : Number((stat.approved / stat.resolved).toFixed(4));
  }

  return [...byCategory.values()].sort(
    (a, b) => b.resolved - a.resolved || b.total - a.total || a.category.localeCompare(b.category),
  );
}

/** Tuning knobs for {@link recommendThreshold}. All have safe defaults. */
export interface ThresholdTuneOptions {
  /** Don't tune until at least this many proposals are resolved (default 8). */
  minSample?: number;
  /** Approval rate at or below this → raise the threshold (default 0.34). */
  lowApproval?: number;
  /** Approval rate at or above this → lower the threshold (default 0.8). */
  highApproval?: number;
  /** How far to nudge the threshold per recommendation (default 0.03). */
  step?: number;
  /** Lower clamp for the threshold (default 0.6). */
  min?: number;
  /** Upper clamp for the threshold (default 0.95). */
  max?: number;
}

/** A bounded change to a similarity-style threshold, with its rationale. */
export interface ThresholdRecommendation {
  category: string;
  /** The threshold this recommendation was computed against. */
  current: number;
  /** The proposed threshold (clamped to `[min, max]`). */
  recommended: number;
  /** The approval rate that drove the recommendation. */
  approvalRate: number;
  /** The resolved sample size behind the rate. */
  resolved: number;
  /** Human-readable explanation, carried onto the API/MCP response. */
  reason: string;
}

const DEFAULT_TUNE: Required<ThresholdTuneOptions> = {
  minSample: 8,
  lowApproval: 0.34,
  highApproval: 0.8,
  step: 0.03,
  min: 0.6,
  max: 0.95,
};

/** Round a tuned threshold to 4dp so repeated nudges stay stable. */
function round4(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Turn a category's approval rate into a **bounded** threshold nudge, or
 * `null` when there is no actionable change. A low approval rate (the human
 * keeps rejecting) raises the threshold so the scan proposes fewer, more
 * confident matches; a high rate lowers it so the scan gets more aggressive.
 *
 * Returns `null` when: the resolved sample is below `minSample` (not enough
 * signal), the rate sits in the comfortable band, or the nudge would be
 * clamped back to `current` (already at the bound). The human stays the gate —
 * this only changes how many suggestions are surfaced, never approves one.
 */
export function recommendThreshold(
  stat: CategoryStat,
  current: number,
  options: ThresholdTuneOptions = {},
): ThresholdRecommendation | null {
  const tune = { ...DEFAULT_TUNE, ...options };
  if (stat.resolved < tune.minSample || stat.approvalRate === null) {
    return null;
  }

  const rate = stat.approvalRate;
  let recommended: number;
  let direction: string;
  if (rate <= tune.lowApproval) {
    recommended = Math.min(tune.max, round4(current + tune.step));
    direction = `low approval (${Math.round(rate * 100)}% of ${stat.resolved}) — raise the bar so fewer, more confident suggestions are proposed`;
  } else if (rate >= tune.highApproval) {
    recommended = Math.max(tune.min, round4(current - tune.step));
    direction = `high approval (${Math.round(rate * 100)}% of ${stat.resolved}) — lower the bar so more candidate matches are surfaced`;
  } else {
    return null; // comfortable band — leave it alone
  }

  if (recommended === current) {
    return null; // already clamped at the bound — nothing to do
  }

  return {
    category: stat.category,
    current,
    recommended,
    approvalRate: rate,
    resolved: stat.resolved,
    reason: `${stat.category}: ${direction}.`,
  };
}
