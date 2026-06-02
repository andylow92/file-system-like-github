/**
 * Tiny in-memory LRU cache so a retried `PATCH /api/file` with the same
 * idempotency key returns the original response without writing again.
 *
 * Local-tool scope: keys survive only as long as the API process. A restart
 * resets the cache — a retry across a restart re-applies the patch. For a
 * single-user local vault that's an acceptable trade-off; persistence would
 * cost more than it buys.
 */
export interface IdempotencyCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

const DEFAULT_CAPACITY = 256;

export function createIdempotencyCache<T>(capacity = DEFAULT_CAPACITY): IdempotencyCache<T> {
  const entries = new Map<string, T>();

  return {
    get(key: string): T | undefined {
      const value = entries.get(key);
      if (value === undefined) {
        return undefined;
      }
      // Bump to most-recently-used.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key: string, value: T): void {
      if (entries.has(key)) {
        entries.delete(key);
      } else if (entries.size >= capacity) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }
      entries.set(key, value);
    },
  };
}
