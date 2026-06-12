/**
 * The retrieval eval harness (backlog #20): runs the golden
 * `query → expected-note` fixture against the three real ranking stacks —
 * `/api/search` (lexical), `/api/semantic-search` (TF-IDF cosine), and
 * `/api/hybrid-search` (RRF fusion) — through the live server + cached
 * `VaultIndex`, and pins recall floors so a ranking change (a tokenizer tweak,
 * a chunking change, a future embedding engine behind the same seam) cannot
 * silently regress retrieval. A failure prints `formatEvalReport`, naming the
 * exact queries that got worse.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatEvalReport, scoreEvalCase, summarizeEval, type EvalSummary } from '@repo/shared';

import { EVAL_CASES, EVAL_CORPUS, EVAL_K } from '../__tests__/fixtures/retrievalCorpus.js';

// Fetch more hits than the cutoff: the semantic endpoint ranks chunks, so the
// top-k *distinct notes* can sit beyond the first k raw hits.
const FETCH_LIMIT = 25;

describe('retrieval eval harness (golden query → expected-note fixture)', () => {
  let contentRoot = '';
  let baseUrl = '';
  let server: http.Server | undefined;

  /** Run every eval case against one search endpoint and summarize. */
  async function runEval(endpoint: string): Promise<EvalSummary> {
    const results = [];
    for (const evalCase of EVAL_CASES) {
      const query = encodeURIComponent(evalCase.query);
      const response = await fetch(`${baseUrl}${endpoint}?q=${query}&limit=${FETCH_LIMIT}`);
      const body = (await response.json()) as { success: boolean; data?: { path: string }[] };
      expect(response.status).toBe(200);
      const ranked = (body.data ?? []).map((hit) => hit.path);
      results.push(scoreEvalCase(evalCase, ranked, EVAL_K));
    }
    return summarizeEval(results, EVAL_K);
  }

  beforeAll(async () => {
    contentRoot = await mkdtemp(path.join(os.tmpdir(), 'retrieval-eval-'));
    process.env.CONTENT_ROOT = contentRoot;

    const { createServer } = await import('../server.js');
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, () => resolve()));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine server address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    for (const note of EVAL_CORPUS) {
      const response = await fetch(`${baseUrl}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      });
      expect(response.status).toBe(201);
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
    await rm(contentRoot, { recursive: true, force: true });
  });

  // Floors sit just below each engine's measured score on this fixture, so a
  // regression fails while an improvement passes. When a floor breaks, read
  // the report in the assertion message — it names the queries that got worse.
  // Raise a floor when an engine genuinely improves; never lower one to ship.

  it('lexical search clears its recall floor (exact phrases + filenames)', async () => {
    const summary = await runEval('/api/search');
    expect(summary.meanRecall, formatEvalReport('lexical', summary)).toBeGreaterThanOrEqual(0.4);
  });

  it('semantic search clears its recall floor (paraphrases + stemming)', async () => {
    const summary = await runEval('/api/semantic-search');
    expect(summary.meanRecall, formatEvalReport('semantic', summary)).toBeGreaterThanOrEqual(0.85);
    expect(
      summary.meanReciprocalRank,
      formatEvalReport('semantic', summary),
    ).toBeGreaterThanOrEqual(0.8);
  });

  it('hybrid fusion retrieves every expected note — the point of RRF', async () => {
    const summary = await runEval('/api/hybrid-search');
    expect(summary.failures, formatEvalReport('hybrid', summary)).toEqual([]);
    expect(summary.meanRecall).toBe(1);
    expect(summary.meanReciprocalRank, formatEvalReport('hybrid', summary)).toBeGreaterThanOrEqual(
      0.8,
    );
  });

  it('hybrid recall is at least as good as either engine alone', async () => {
    const [lexical, semantic, hybrid] = [
      await runEval('/api/search'),
      await runEval('/api/semantic-search'),
      await runEval('/api/hybrid-search'),
    ];
    expect(hybrid.meanRecall).toBeGreaterThanOrEqual(lexical.meanRecall);
    expect(hybrid.meanRecall).toBeGreaterThanOrEqual(semantic.meanRecall);
  });
});
