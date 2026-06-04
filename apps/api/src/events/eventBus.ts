import type { VaultEvent } from '@repo/shared';

/**
 * A tiny in-process pub/sub bus for live vault events. Route handlers publish to
 * it on every successful mutation (alongside the audit write); the filesystem
 * watcher publishes out-of-band edits; the SSE endpoint subscribes and streams
 * events to connected web clients. No external dependency — just a Set of
 * listeners.
 */
export type VaultEventListener = (event: VaultEvent) => void;

export interface EventBus {
  publish(event: VaultEvent): void;
  /** Subscribe to events; returns an unsubscribe function. */
  subscribe(listener: VaultEventListener): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<VaultEventListener>();

  return {
    publish(event: VaultEvent): void {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // A misbehaving subscriber (e.g. a closed SSE response) must never
          // break publishing for the others.
        }
      }
    },
    subscribe(listener: VaultEventListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
