import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { EditProposal, ProposalAction, ProposalStatus } from '@repo/shared';

/**
 * Store for agent-proposed edits awaiting human review. Each proposal is a JSON
 * file under a hidden `.fsbrain/proposals/` directory inside CONTENT_ROOT
 * (hidden directories are excluded from the file tree). Proposals are the
 * trust loop: agents propose, a human approves/rejects.
 */
export interface CreateProposalInput {
  actor: string;
  action: ProposalAction;
  path: string;
  content?: string;
  baseEtag?: string;
  note?: string;
}

export interface ProposalStore {
  create(input: CreateProposalInput): Promise<EditProposal>;
  list(options?: { status?: ProposalStatus }): Promise<EditProposal[]>;
  get(id: string): Promise<EditProposal | undefined>;
  resolve(
    id: string,
    resolution: { status: 'approved' | 'rejected'; resolvedBy: string },
  ): Promise<EditProposal>;
}

export const PROPOSALS_DIR = '.fsbrain/proposals';

export function createProposalStore(rootPath: string): ProposalStore {
  const dir = path.join(rootPath, PROPOSALS_DIR);

  const fileFor = (id: string) => path.join(dir, `${id}.json`);

  async function readProposal(file: string): Promise<EditProposal | undefined> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as EditProposal;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async function write(proposal: EditProposal): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fileFor(proposal.id), JSON.stringify(proposal, null, 2), 'utf8');
  }

  async function create(input: CreateProposalInput): Promise<EditProposal> {
    const proposal: EditProposal = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      path: input.path,
      status: 'pending',
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.baseEtag ? { baseEtag: input.baseEtag } : {}),
      ...(input.note ? { note: input.note } : {}),
    };
    await write(proposal);
    return proposal;
  }

  async function list(options: { status?: ProposalStatus } = {}): Promise<EditProposal[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const proposals: EditProposal[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const proposal = await readProposal(path.join(dir, entry));
      if (proposal && (!options.status || proposal.status === options.status)) {
        proposals.push(proposal);
      }
    }

    // Newest first.
    return proposals.sort((a, b) => b.ts.localeCompare(a.ts));
  }

  async function get(id: string): Promise<EditProposal | undefined> {
    return readProposal(fileFor(id));
  }

  async function resolve(
    id: string,
    resolution: { status: 'approved' | 'rejected'; resolvedBy: string },
  ): Promise<EditProposal> {
    const proposal = await readProposal(fileFor(id));
    if (!proposal) {
      throw new Error('Proposal not found');
    }

    const resolved: EditProposal = {
      ...proposal,
      status: resolution.status,
      resolvedTs: new Date().toISOString(),
      resolvedBy: resolution.resolvedBy,
    };
    await write(resolved);
    return resolved;
  }

  return { create, list, get, resolve };
}
