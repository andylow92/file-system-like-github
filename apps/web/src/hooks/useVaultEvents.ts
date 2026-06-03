import { useEffect, useRef, useState } from 'react';
import type { VaultEvent } from '@repo/shared';

/** Connection state for the unobtrusive live indicator. */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export interface UseVaultEventsOptions {
  /** The currently-open file, so we know when an event affects it. */
  openFilePath?: string | null;
  /** Structural change (create/delete/move/dir): refresh the tree. */
  onTreeChanged?: () => void;
  /** The open file changed on disk: refresh it (caller guards unsaved drafts). */
  onOpenFileChanged?: (path: string) => void;
  /** Any change: refresh the Activity feed. */
  onActivity?: () => void;
  /** A proposal was created/resolved: refresh the Review pending count. */
  onPendingChanged?: () => void;
  /** Set false to disable (e.g. in environments without EventSource). */
  enabled?: boolean;
}

const RECONNECT_DELAY_MS = 2000;

/**
 * Route a single VaultEvent to the right surgical refresh. Exported for unit
 * tests. Every event bumps the Activity feed (it is all provenance); structural
 * events refresh the tree; an update to the open file refreshes it; proposal
 * events refresh the pending-review count.
 */
export function routeVaultEvent(event: VaultEvent, options: UseVaultEventsOptions): void {
  options.onActivity?.();

  switch (event.type) {
    case 'created':
    case 'deleted':
    case 'dir_created':
      options.onTreeChanged?.();
      break;
    case 'moved':
      options.onTreeChanged?.();
      if (event.path === options.openFilePath || event.toPath === options.openFilePath) {
        options.onOpenFileChanged?.(event.toPath ?? event.path);
      }
      break;
    case 'updated':
      if (event.path === options.openFilePath) {
        options.onOpenFileChanged?.(event.path);
      }
      break;
    case 'proposal_created':
    case 'proposal_resolved':
      options.onPendingChanged?.();
      break;
    default:
      break;
  }
}

/**
 * Subscribe to the server's `/api/events` SSE stream and surgically refresh the
 * UI as the vault changes — so an agent's (or another client's) writes appear
 * live without a manual refresh. Auto-reconnects on drop. Returns the live
 * connection status for an indicator.
 */
export function useVaultEvents(options: UseVaultEventsOptions): { status: LiveStatus } {
  const [status, setStatus] = useState<LiveStatus>('connecting');

  // Keep the latest options (callbacks + open file) in a ref so the EventSource
  // is set up once and isn't torn down every time the open file changes.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      source = new EventSource('/api/events');

      source.onopen = () => {
        setStatus('live');
      };

      source.onmessage = (message: MessageEvent<string>) => {
        let event: VaultEvent;
        try {
          event = JSON.parse(message.data) as VaultEvent;
        } catch {
          return;
        }
        routeVaultEvent(event, optionsRef.current);
      };

      source.onerror = () => {
        setStatus('reconnecting');
        source?.close();
        source = null;
        if (!closed) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      source?.close();
    };
  }, [enabled]);

  return { status };
}
