import { describe, expect, it } from 'vitest';
import {
  diffDraftFinal,
  feedbackMarker,
  parseFeedbackPairing,
  scanFeedback,
  type FeedbackDocument,
} from '@repo/shared';

/** Build a `type: feedback` pairing note's content. */
function pairNote(fields: Record<string, string>): string {
  const lines = ['---', 'type: feedback'];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---', 'Pairing note body is ignored.');
  return lines.join('\n');
}

describe('parseFeedbackPairing', () => {
  it('parses a full pairing and normalizes the channel + target', () => {
    const pairing = parseFeedbackPairing(
      'social/x/pair.md',
      pairNote({
        channel: 'X',
        draftPath: 'social/x/drafts/launch.md',
        finalPath: 'social/x/old-posts/launch.md',
        targetPath: 'social/x/post-patterns', // no .md — normalized
        reviewReason: 'Too salesy; lead with customer pain.',
      }),
    );
    expect(pairing).toEqual({
      pairPath: 'social/x/pair.md',
      channel: 'x',
      draftPath: 'social/x/drafts/launch.md',
      finalPath: 'social/x/old-posts/launch.md',
      targetPath: 'social/x/post-patterns.md',
      reviewReason: 'Too salesy; lead with customer pain.',
    });
  });

  it('defaults the target to feedback/<channel>.md when unset', () => {
    const pairing = parseFeedbackPairing(
      'p.md',
      pairNote({ channel: 'linkedin', draftPath: 'd.md', finalPath: 'f.md' }),
    );
    expect(pairing?.targetPath).toBe('feedback/linkedin.md');
    expect(pairing?.reviewReason).toBeUndefined();
  });

  it('rejects non-feedback notes, unknown channels, and incomplete pairings', () => {
    expect(parseFeedbackPairing('n.md', '# Plain note\nNo frontmatter.')).toBeNull();
    expect(parseFeedbackPairing('n.md', '---\ntype: skill\n---\nBody')).toBeNull();
    // Unknown channel.
    expect(
      parseFeedbackPairing(
        'p.md',
        pairNote({ channel: 'tiktok', draftPath: 'd.md', finalPath: 'f.md' }),
      ),
    ).toBeNull();
    // Missing finalPath.
    expect(parseFeedbackPairing('p.md', pairNote({ channel: 'x', draftPath: 'd.md' }))).toBeNull();
  });
});

describe('diffDraftFinal', () => {
  it('counts words on the body only and collects unique segments', () => {
    const draft =
      '---\ntype: x-draft\n---\nThis is a very long salesy pitch about Eigenoid that drags on.';
    const final = 'Short and punchy.';
    const diff = diffDraftFinal(draft, final);

    expect(diff.draftWords).toBe(12); // frontmatter (`type: x-draft`) is not counted
    expect(diff.finalWords).toBe(3);
    expect(diff.wordDelta).toBe(-9);
    expect(diff.removed).toEqual([
      'This is a very long salesy pitch about Eigenoid that drags on.',
    ]);
    expect(diff.added).toEqual(['Short and punchy.']);
  });

  it('compares case-insensitively but reports shared lines as unchanged', () => {
    const diff = diffDraftFinal('Keep this line.\nDrop me.', 'keep THIS line.\nAdd me.');
    expect(diff.removed).toEqual(['Drop me.']); // "Keep this line." matches case-insensitively
    expect(diff.added).toEqual(['Add me.']);
  });

  it('caps the example segments at maxSegments', () => {
    const draft = 'a. b. c. d.';
    const diff = diffDraftFinal(draft, 'totally different.', 2);
    expect(diff.removed).toHaveLength(2);
  });
});

describe('scanFeedback', () => {
  const draft = {
    path: 'social/x/drafts/launch.md',
    content: 'Eigenoid makes you compliant. Buy today.',
  };
  const final = {
    path: 'social/x/old-posts/launch.md',
    content: 'Audit evidence map for compliance teams. Lead with the pain.',
  };

  it('files a create suggestion (new type: skill playbook) when no target exists', () => {
    const docs: FeedbackDocument[] = [
      {
        path: 'social/x/pair.md',
        content: pairNote({
          channel: 'x',
          draftPath: draft.path,
          finalPath: final.path,
          reviewReason: 'Avoid "makes you compliant".',
        }),
      },
      draft,
      final,
    ];
    const [finding] = scanFeedback(docs);
    expect(finding.channel).toBe('x');
    expect(finding.reviewReason).toBe('Avoid "makes you compliant".');
    expect(finding.suggestion?.action).toBe('create');
    expect(finding.suggestion?.path).toBe('feedback/x.md');
    expect(finding.suggestion?.content).toContain('type: skill');
    // The lesson captures the human reason and a stable idempotency marker.
    expect(finding.suggestion?.content).toContain('Avoid "makes you compliant".');
    expect(finding.suggestion?.content).toContain(feedbackMarker(draft.path, final.path));
  });

  it('files an update suggestion that appends to an existing playbook', () => {
    const target = {
      path: 'social/x/post-patterns.md',
      content: '# X post patterns\n\nExisting guidance.',
    };
    const docs: FeedbackDocument[] = [
      {
        path: 'social/x/pair.md',
        content: pairNote({
          channel: 'x',
          draftPath: draft.path,
          finalPath: final.path,
          targetPath: target.path,
        }),
      },
      draft,
      final,
      target,
    ];
    const [finding] = scanFeedback(docs);
    expect(finding.suggestion?.action).toBe('update');
    expect(finding.suggestion?.path).toBe(target.path);
    expect(finding.suggestion?.content).toContain('Existing guidance.'); // preserved
    expect(finding.suggestion?.content).toContain('### Review feedback'); // appended
  });

  it('stays quiet once the lesson marker is already in the target (idempotent)', () => {
    const target = {
      path: 'feedback/x.md',
      content: `# X\n\n${feedbackMarker(draft.path, final.path)}`,
    };
    const docs: FeedbackDocument[] = [
      {
        path: 'social/x/pair.md',
        content: pairNote({ channel: 'x', draftPath: draft.path, finalPath: final.path }),
      },
      draft,
      final,
      target,
    ];
    expect(scanFeedback(docs)).toEqual([]);
  });

  it('reports (without a suggestion) when a draft or final is missing, or nothing changed', () => {
    const missing = scanFeedback([
      {
        path: 'p.md',
        content: pairNote({
          channel: 'email',
          draftPath: 'nope-draft.md',
          finalPath: 'nope-final.md',
        }),
      },
    ]);
    expect(missing).toHaveLength(1);
    expect(missing[0].suggestion).toBeUndefined();
    expect(missing[0].detail).toContain('not found');

    const unchanged = scanFeedback([
      {
        path: 'p.md',
        content: pairNote({ channel: 'email', draftPath: 'd.md', finalPath: 'f.md' }),
      },
      { path: 'd.md', content: 'Identical body.' },
      { path: 'f.md', content: 'Identical body.' },
    ]);
    expect(unchanged[0].suggestion).toBeUndefined();
    expect(unchanged[0].detail).toContain('nothing to learn');
  });

  it('handles x, linkedin, and email pairs and orders findings deterministically', () => {
    const docs: FeedbackDocument[] = [
      {
        path: 'z-pair.md',
        content: pairNote({ channel: 'x', draftPath: 'xd.md', finalPath: 'xf.md' }),
      },
      {
        path: 'a-pair.md',
        content: pairNote({ channel: 'linkedin', draftPath: 'ld.md', finalPath: 'lf.md' }),
      },
      {
        path: 'm-pair.md',
        content: pairNote({ channel: 'email', draftPath: 'ed.md', finalPath: 'ef.md' }),
      },
      { path: 'xd.md', content: 'X draft long version here.' },
      { path: 'xf.md', content: 'X final.' },
      { path: 'ld.md', content: 'LinkedIn draft long version.' },
      { path: 'lf.md', content: 'LinkedIn final.' },
      { path: 'ed.md', content: 'Email draft long version.' },
      { path: 'ef.md', content: 'Email final.' },
    ];
    const findings = scanFeedback(docs);
    expect(findings.map((f) => f.channel)).toEqual(['email', 'linkedin', 'x']); // sorted by channel
    expect(findings.map((f) => f.suggestion?.path)).toEqual([
      'feedback/email.md',
      'feedback/linkedin.md',
      'feedback/x.md',
    ]);
    // Deterministic: same corpus, same findings.
    expect(scanFeedback(docs)).toEqual(findings);
  });
});
