import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { AuditEntry } from '@repo/shared';

/**
 * Append-only provenance log. Records who changed what, so agent edits stay
 * legible to humans. Stored as JSON Lines under a hidden `.fsbrain/` directory
 * inside CONTENT_ROOT (hidden directories are excluded from the file tree).
 */
export interface AuditLog {
  record(entry: Omit<AuditEntry, 'ts'>): Promise<void>;
  list(options?: { path?: string; limit?: number }): Promise<AuditEntry[]>;
}

export const AUDIT_DIR = '.fsbrain';
export const AUDIT_FILE = 'audit.jsonl';

export function createAuditLog(rootPath: string): AuditLog {
  const dir = path.join(rootPath, AUDIT_DIR);
  const file = path.join(dir, AUDIT_FILE);

  async function record(entry: Omit<AuditEntry, 'ts'>): Promise<void> {
    const full: AuditEntry = { ts: new Date().toISOString(), ...entry };
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(full)}\n`, 'utf8');
  }

  async function list(options: { path?: string; limit?: number } = {}): Promise<AuditEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const entries: AuditEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip malformed lines rather than failing the whole read.
      }
    }

    const filtered = options.path
      ? entries.filter((entry) => entry.path === options.path || entry.toPath === options.path)
      : entries;

    const newestFirst = filtered.reverse();
    return typeof options.limit === 'number' ? newestFirst.slice(0, options.limit) : newestFirst;
  }

  return { record, list };
}
