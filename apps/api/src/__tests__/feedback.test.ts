import { describe, expect, it } from 'vitest';
import {
  diffDraftFinal,
  DRAFT_COPY_HEADINGS,
  extractCopySection,
  feedbackMarker,
  FINAL_COPY_HEADINGS,
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

describe('extractCopySection', () => {
  it('extracts the section under a preferred heading, stopping at the next same-level heading', () => {
    const body = [
      '# X Draft 2026-06-01',
      '',
      'Status: posted',
      'Created: 2026-06-01',
      '',
      '## Final Draft',
      '',
      'Lead with the customer pain, not the product.',
      '',
      '## Notes',
      '',
      'Internal reasoning here.',
    ].join('\n');
    expect(extractCopySection(body, DRAFT_COPY_HEADINGS)).toBe(
      'Lead with the customer pain, not the product.',
    );
  });

  it('extracts a final note `## Post` section and leaves the metadata behind', () => {
    const body = [
      '# X Post 2026-06-02',
      '',
      'Source draft: [[X Draft 2026-06-01]]',
      'URL: https://x.com/example',
      'Lane: compliance',
      '',
      '## Post',
      '',
      'Audit evidence, mapped. Lead with the workflow pain.',
    ].join('\n');
    expect(extractCopySection(body, FINAL_COPY_HEADINGS)).toBe(
      'Audit evidence, mapped. Lead with the workflow pain.',
    );
  });

  it('returns null when no preferred heading is present (full-body fallback)', () => {
    expect(
      extractCopySection('Just plain copy.\nNo headings here.', DRAFT_COPY_HEADINGS),
    ).toBeNull();
    expect(
      extractCopySection('# Title only\n\nBody under a non-copy heading.', FINAL_COPY_HEADINGS),
    ).toBeNull();
  });

  it('respects priority order, not document order', () => {
    const body = ['## Post', 'Early rough post text.', '', '## Final Draft', 'Polished copy.'].join(
      '\n',
    );
    // `## Post` appears first, but DRAFT priority prefers `## Final Draft`.
    expect(extractCopySection(body, DRAFT_COPY_HEADINGS)).toBe('Polished copy.');
  });

  it('keeps deeper subheadings but stops at a higher-level heading', () => {
    const body = [
      '## Copy',
      'Main copy line.',
      '',
      '### Variant',
      'A sub-variant still part of the copy.',
      '',
      '# Appendix',
      'Outside — a higher-level heading ends the section.',
    ].join('\n');
    expect(extractCopySection(body, ['Copy'])).toBe(
      ['Main copy line.', '', '### Variant', 'A sub-variant still part of the copy.'].join('\n'),
    );
  });

  it('ignores headings inside fenced code blocks', () => {
    const body = [
      '## Post',
      'Real copy.',
      '',
      '```',
      '## Not a heading inside code',
      '```',
      'Still real copy.',
    ].join('\n');
    expect(extractCopySection(body, ['Post'])).toBe(
      ['Real copy.', '', '```', '## Not a heading inside code', '```', 'Still real copy.'].join(
        '\n',
      ),
    );
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

  it('compares only the reviewed-copy section when explicit headings exist', () => {
    const draft = [
      '---',
      'type: x-draft',
      '---',
      '# X Draft 2026-06-01',
      'Status: draft',
      'Chosen lane: compliance',
      '',
      '## Final Draft',
      '',
      'Eigenoid makes you compliant today.',
      '',
      '## Notes',
      'Internal reasoning we should ignore entirely.',
    ].join('\n');
    const final = [
      '---',
      'type: x-post',
      '---',
      '# X Post 2026-06-02',
      'URL: https://x.com/abc',
      'Lane: compliance',
      '',
      '## Post',
      '',
      'Audit evidence mapped for compliance teams.',
    ].join('\n');
    const diff = diffDraftFinal(draft, final);

    // Word counts reflect the copy sections only — not the title, metadata, or `## Notes`.
    expect(diff.draftWords).toBe(5);
    expect(diff.finalWords).toBe(6);
    expect(diff.removed).toEqual(['Eigenoid makes you compliant today.']);
    expect(diff.added).toEqual(['Audit evidence mapped for compliance teams.']);
    // No metadata leaks into the diff.
    expect(JSON.stringify(diff)).not.toMatch(/Status|URL|Lane|Notes|Internal reasoning/);
  });

  it('treats metadata-only changes around identical copy as nothing to learn', () => {
    const draft = [
      '---',
      'type: x-draft',
      '---',
      'Status: draft',
      '',
      '## Draft',
      '',
      'Same copy text here.',
    ].join('\n');
    const final = [
      '---',
      'type: x-post',
      '---',
      'Status: posted',
      'URL: https://x.com/z',
      '',
      '## Post',
      '',
      'Same copy text here.',
    ].join('\n');
    const diff = diffDraftFinal(draft, final);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.wordDelta).toBe(0);
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

  it('files a lesson from the copy sections only, never the surrounding metadata', () => {
    const wrappedDraft = {
      path: 'social/x/drafts/launch.md',
      content: [
        '---',
        'type: x-draft',
        '---',
        '# X Draft 2026-06-01',
        'Status: draft',
        'Chosen lane: compliance',
        '',
        '## Final Draft',
        '',
        'Eigenoid makes you compliant today.',
      ].join('\n'),
    };
    const wrappedFinal = {
      path: 'social/x/old-posts/launch.md',
      content: [
        '---',
        'type: x-post',
        '---',
        '# X Post 2026-06-02',
        'URL: https://x.com/abc',
        'Lane: compliance',
        '',
        '## Post',
        '',
        'Audit evidence mapped for compliance teams.',
      ].join('\n'),
    };
    const docs: FeedbackDocument[] = [
      {
        path: 'social/x/pair.md',
        content: pairNote({
          channel: 'x',
          draftPath: wrappedDraft.path,
          finalPath: wrappedFinal.path,
        }),
      },
      wrappedDraft,
      wrappedFinal,
    ];
    const [finding] = scanFeedback(docs);
    expect(finding.suggestion?.action).toBe('create');
    const content = finding.suggestion!.content;
    expect(content).toContain('Eigenoid makes you compliant today.');
    expect(content).toContain('Audit evidence mapped for compliance teams.');
    // Wrapper metadata must never reach the proposed lesson.
    expect(content).not.toMatch(/Status|URL|Lane|Chosen lane/);
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
