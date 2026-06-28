import { describe, expect, it } from 'vitest';
import {
  categoryOf,
  recommendThreshold,
  summarizeOutcomes,
  type CategoryStat,
  type ProposalRecord,
} from '@repo/shared';

/** Build a minimal proposal record for the stats helper. */
function rec(
  fields: Partial<ProposalRecord> & { status: ProposalRecord['status'] },
): ProposalRecord {
  return { actor: 'agent:maintenance', action: 'update', ...fields };
}

describe('categoryOf', () => {
  it('uses the explicit category when present', () => {
    expect(categoryOf(rec({ category: 'maintenance:duplicate', status: 'approved' }))).toBe(
      'maintenance:duplicate',
    );
  });

  it('falls back to actor:action for legacy proposals without a category', () => {
    expect(categoryOf(rec({ actor: 'agent:mcp', action: 'create', status: 'pending' }))).toBe(
      'agent:mcp:create',
    );
  });

  it('treats a blank category as absent', () => {
    expect(
      categoryOf(rec({ actor: 'human', action: 'delete', category: '  ', status: 'approved' })),
    ).toBe('human:delete');
  });
});

describe('summarizeOutcomes', () => {
  it('tallies approved/rejected/pending per category and computes the rate', () => {
    const stats = summarizeOutcomes([
      rec({ category: 'maintenance:duplicate', status: 'approved' }),
      rec({ category: 'maintenance:duplicate', status: 'rejected' }),
      rec({ category: 'maintenance:duplicate', status: 'rejected' }),
      rec({ category: 'maintenance:duplicate', status: 'pending' }),
      rec({ category: 'feedback:x', status: 'approved' }),
    ]);

    const dup = stats.find((s) => s.category === 'maintenance:duplicate')!;
    expect(dup).toMatchObject({
      approved: 1,
      rejected: 2,
      pending: 1,
      resolved: 3,
      total: 4,
      approvalRate: Number((1 / 3).toFixed(4)),
    });

    const fx = stats.find((s) => s.category === 'feedback:x')!;
    expect(fx.approvalRate).toBe(1);
    expect(fx.resolved).toBe(1);
  });

  it('reports a null rate when a category has no resolved proposals', () => {
    const [stat] = summarizeOutcomes([
      rec({ category: 'maintenance:broken_link', status: 'pending' }),
    ]);
    expect(stat.approvalRate).toBeNull();
    expect(stat.resolved).toBe(0);
  });

  it('orders by resolved desc, then total desc, then category asc — deterministically', () => {
    const proposals: ProposalRecord[] = [
      rec({ category: 'b', status: 'approved' }),
      rec({ category: 'b', status: 'rejected' }),
      rec({ category: 'a', status: 'approved' }),
      rec({ category: 'c', status: 'pending' }),
      rec({ category: 'c', status: 'pending' }),
    ];
    const order = summarizeOutcomes(proposals).map((s) => s.category);
    // b has 2 resolved (first), a has 1 resolved (second), c has 0 resolved (last).
    expect(order).toEqual(['b', 'a', 'c']);
    // Same input → same output.
    expect(summarizeOutcomes(proposals).map((s) => s.category)).toEqual(order);
  });
});

/** A category stat with the fields recommendThreshold reads. */
function stat(approvalRate: number | null, resolved: number): CategoryStat {
  const approved = approvalRate === null ? 0 : Math.round(approvalRate * resolved);
  return {
    category: 'maintenance:duplicate',
    approved,
    rejected: resolved - approved,
    pending: 0,
    resolved,
    total: resolved,
    approvalRate,
  };
}

describe('recommendThreshold', () => {
  it('raises the threshold when approval is low', () => {
    const rec = recommendThreshold(stat(0.2, 10), 0.85);
    expect(rec).not.toBeNull();
    expect(rec!.recommended).toBe(0.88);
    expect(rec!.reason).toContain('raise');
  });

  it('lowers the threshold when approval is high', () => {
    const rec = recommendThreshold(stat(0.95, 10), 0.85);
    expect(rec!.recommended).toBe(0.82);
    expect(rec!.reason).toContain('lower');
  });

  it('returns null inside the comfortable band', () => {
    expect(recommendThreshold(stat(0.6, 10), 0.85)).toBeNull();
  });

  it('returns null below the sample floor (not enough signal)', () => {
    expect(recommendThreshold(stat(0.1, 4), 0.85)).toBeNull();
  });

  it('returns null when there is no resolved signal', () => {
    expect(recommendThreshold(stat(null, 0), 0.85)).toBeNull();
  });

  it('clamps to the bounds and returns null when already at the limit', () => {
    // Already at max: a low rate would push past 0.95, so it clamps and no-ops.
    expect(recommendThreshold(stat(0.1, 10), 0.95)).toBeNull();
    // Already at min: a high rate would push below 0.6, so it clamps and no-ops.
    expect(recommendThreshold(stat(0.99, 10), 0.6)).toBeNull();
  });

  it('honors custom tuning knobs', () => {
    const rec = recommendThreshold(stat(0.5, 6), 0.8, {
      minSample: 5,
      lowApproval: 0.55,
      step: 0.1,
    });
    expect(rec!.recommended).toBe(0.9);
  });
});
