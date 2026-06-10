import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { QuestionEntry } from '@repo/shared';

/**
 * Append-only log of `think` questions and their offline gap signal
 * (`weakCoverage` + `uncoveredTerms`), so recurring unanswerable questions
 * become visible instead of vanishing with the response. Stored as JSON Lines
 * beside the audit log under the hidden `.fsbrain/` directory (excluded from
 * the file tree). Logging is best-effort at the call site — a log failure must
 * never fail the question itself.
 */
export interface QuestionLog {
  record(entry: Omit<QuestionEntry, 'ts'>): Promise<void>;
  list(options?: { limit?: number }): Promise<QuestionEntry[]>;
}

export const QUESTIONS_DIR = '.fsbrain';
export const QUESTIONS_FILE = 'questions.jsonl';

export function createQuestionLog(rootPath: string): QuestionLog {
  const dir = path.join(rootPath, QUESTIONS_DIR);
  const file = path.join(dir, QUESTIONS_FILE);

  async function record(entry: Omit<QuestionEntry, 'ts'>): Promise<void> {
    const full: QuestionEntry = { ts: new Date().toISOString(), ...entry };
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(full)}\n`, 'utf8');
  }

  async function list(options: { limit?: number } = {}): Promise<QuestionEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const entries: QuestionEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        entries.push(JSON.parse(line) as QuestionEntry);
      } catch {
        // Skip malformed lines rather than failing the whole read.
      }
    }

    const newestFirst = entries.reverse();
    return typeof options.limit === 'number' ? newestFirst.slice(0, options.limit) : newestFirst;
  }

  return { record, list };
}
