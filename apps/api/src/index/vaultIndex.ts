import {
  buildSemanticIndex,
  queryRankedChunks,
  querySemanticIndex,
  type RankQueryOptions,
  type RankedChunk,
  type SemanticDocument,
  type SemanticHit,
  type SemanticIndex,
} from '@repo/shared';

import type { EventBus } from '../events/eventBus.js';
import type { FileRepository, TreeNode } from '../storage/fileRepository.js';

/**
 * An in-memory, lazily-built retrieval cache over the vault. It reads every
 * note once, builds a `SemanticIndex` (chunks + IDF + per-chunk vectors) once,
 * and reuses it across queries — so retrieval no longer re-reads the whole vault
 * per request.
 *
 * It stays fresh by subscribing to the live-layer `EventBus`: any
 * create/update/move/delete (from the API or the file watcher) invalidates the
 * affected entry and the derived index, so the next query rebuilds from disk —
 * reusing the cached content of unchanged notes — and never serves stale
 * results after a write. Both full-text (`getDocuments`) and semantic
 * (`semanticSearch` / `rankedChunks`) retrieval read through this cache, so
 * ranking is identical to reading the vault fresh each time.
 *
 * Conventions preserved: `.fsbrain/` and other dotfiles never enter the corpus
 * (they are already excluded from `listTree`).
 */
export interface VaultIndex {
  /** The cached corpus (logical path → content), refreshed lazily before return. */
  getDocuments(): Promise<readonly SemanticDocument[]>;
  /** Semantic hits (display snippets) — backs `GET /api/semantic-search`. */
  semanticSearch(query: string, options?: RankQueryOptions): Promise<SemanticHit[]>;
  /** Ranked chunks carrying full text — used to assemble context bundles. */
  rankedChunks(query: string, options?: RankQueryOptions): Promise<RankedChunk[]>;
  /** Unsubscribe from the event bus (called on server close). */
  close(): void;
}

function flattenMarkdownPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.isDirectory) {
      paths.push(...flattenMarkdownPaths(node.children ?? []));
    } else {
      paths.push(node.path);
    }
  }
  return paths;
}

export function createVaultIndex(options: {
  repository: FileRepository;
  eventBus: EventBus;
}): VaultIndex {
  const { repository, eventBus } = options;

  // Cached note contents, the ordered corpus, and the derived semantic index.
  const contentCache = new Map<string, string>();
  let documents: SemanticDocument[] = [];
  let semanticIndex: SemanticIndex | null = null;

  // A monotonically increasing change counter. Every relevant event bumps it;
  // `indexedSeq` records the value the current `semanticIndex` reflects. They
  // diverge exactly when a rebuild is due.
  let mutationSeq = 0;
  let indexedSeq = -1;
  // Paths whose cached content is known-stale and must be re-read on next build.
  const dirtyPaths = new Set<string>();
  // Coalesce concurrent rebuilds into one.
  let rebuilding: Promise<void> | null = null;

  function markChanged(paths: string[]): void {
    mutationSeq += 1;
    for (const path of paths) {
      dirtyPaths.add(path);
    }
    semanticIndex = null;
  }

  const unsubscribe = eventBus.subscribe((event) => {
    switch (event.type) {
      case 'created':
      case 'updated':
      case 'deleted':
        markChanged([event.path]);
        break;
      case 'moved':
        markChanged(event.toPath ? [event.path, event.toPath] : [event.path]);
        break;
      // `dir_created` adds no markdown; proposal events are followed by the
      // underlying create/update/delete event, which carries the content change.
      default:
        break;
    }
  });

  async function doRebuild(): Promise<void> {
    // Rebuild until the index reflects the latest `mutationSeq`. If a change
    // lands mid-read (`mutationSeq` advances past `target`), redo the pass so we
    // never commit a corpus that is already stale.
    for (;;) {
      const target = mutationSeq;
      const dirtySnapshot = new Set(dirtyPaths);

      const paths = flattenMarkdownPaths(await repository.listTree(''));
      const nextDocuments: SemanticDocument[] = [];
      for (const path of paths) {
        let content = contentCache.get(path);
        if (content === undefined || dirtySnapshot.has(path)) {
          try {
            content = await repository.readMarkdownFile(path);
          } catch {
            // A file that vanished mid-rebuild (e.g. a race with delete) — skip
            // it; the delete event will have bumped the seq, forcing a redo.
            content = undefined;
          }
          if (content !== undefined) {
            contentCache.set(path, content);
          }
        }
        if (content !== undefined) {
          nextDocuments.push({ path, content });
        }
      }

      if (mutationSeq !== target) {
        // A change arrived during the awaited reads; its dirty paths are still
        // pending. Redo without clearing them.
        continue;
      }

      // No change occurred during this pass, so it is safe to commit and to
      // clear the serviced dirty set wholesale.
      dirtyPaths.clear();
      const present = new Set(paths);
      for (const cached of [...contentCache.keys()]) {
        if (!present.has(cached)) {
          contentCache.delete(cached);
        }
      }

      documents = nextDocuments;
      semanticIndex = buildSemanticIndex(nextDocuments);
      indexedSeq = target;
      return;
    }
  }

  async function ensureFresh(): Promise<void> {
    if (semanticIndex && indexedSeq === mutationSeq) {
      return;
    }
    if (rebuilding) {
      await rebuilding;
      if (semanticIndex && indexedSeq === mutationSeq) {
        return;
      }
    }
    rebuilding = doRebuild();
    try {
      await rebuilding;
    } finally {
      rebuilding = null;
    }
  }

  return {
    async getDocuments(): Promise<readonly SemanticDocument[]> {
      await ensureFresh();
      return documents;
    },
    async semanticSearch(
      query: string,
      queryOptions: RankQueryOptions = {},
    ): Promise<SemanticHit[]> {
      await ensureFresh();
      return semanticIndex ? querySemanticIndex(semanticIndex, query, queryOptions) : [];
    },
    async rankedChunks(query: string, queryOptions: RankQueryOptions = {}): Promise<RankedChunk[]> {
      await ensureFresh();
      return semanticIndex ? queryRankedChunks(semanticIndex, query, queryOptions) : [];
    },
    close(): void {
      unsubscribe();
    },
  };
}
