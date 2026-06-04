import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultEvent } from '@repo/shared';
import { routeVaultEvent, useVaultEvents } from '../useVaultEvents';

function event(partial: Partial<VaultEvent> & Pick<VaultEvent, 'type'>): VaultEvent {
  return {
    path: 'note.md',
    actor: 'agent:mcp',
    ts: '2026-06-03T00:00:00.000Z',
    source: 'api',
    ...partial,
  };
}

describe('routeVaultEvent', () => {
  function handlers() {
    return {
      onTreeChanged: vi.fn(),
      onOpenFileChanged: vi.fn(),
      onActivity: vi.fn(),
      onPendingChanged: vi.fn(),
    };
  }

  it('refreshes the open file (and activity) on an update to it', () => {
    const h = handlers();
    routeVaultEvent(event({ type: 'updated', path: 'open.md' }), {
      openFilePath: 'open.md',
      ...h,
    });
    expect(h.onOpenFileChanged).toHaveBeenCalledWith('open.md');
    expect(h.onActivity).toHaveBeenCalledTimes(1);
    expect(h.onTreeChanged).not.toHaveBeenCalled();
  });

  it('does not refresh the open file on an update to a different file', () => {
    const h = handlers();
    routeVaultEvent(event({ type: 'updated', path: 'other.md' }), {
      openFilePath: 'open.md',
      ...h,
    });
    expect(h.onOpenFileChanged).not.toHaveBeenCalled();
    expect(h.onActivity).toHaveBeenCalledTimes(1);
  });

  it('refreshes the tree (and activity) on create/delete/dir events', () => {
    for (const type of ['created', 'deleted', 'dir_created'] as const) {
      const h = handlers();
      routeVaultEvent(event({ type }), { openFilePath: 'open.md', ...h });
      expect(h.onTreeChanged).toHaveBeenCalledTimes(1);
      expect(h.onActivity).toHaveBeenCalledTimes(1);
      expect(h.onOpenFileChanged).not.toHaveBeenCalled();
    }
  });

  it('on a move of the open file, refreshes the tree and the open file', () => {
    const h = handlers();
    routeVaultEvent(event({ type: 'moved', path: 'open.md', toPath: 'moved/open.md' }), {
      openFilePath: 'open.md',
      ...h,
    });
    expect(h.onTreeChanged).toHaveBeenCalledTimes(1);
    expect(h.onOpenFileChanged).toHaveBeenCalledWith('moved/open.md');
    expect(h.onActivity).toHaveBeenCalledTimes(1);
  });

  it('on a move that does not touch the open file, refreshes only the tree', () => {
    const h = handlers();
    routeVaultEvent(event({ type: 'moved', path: 'other.md', toPath: 'archive/other.md' }), {
      openFilePath: 'open.md',
      ...h,
    });
    expect(h.onTreeChanged).toHaveBeenCalledTimes(1);
    expect(h.onOpenFileChanged).not.toHaveBeenCalled();
  });

  it('bumps the pending-review count on proposal events', () => {
    const h = handlers();
    routeVaultEvent(event({ type: 'proposal_created' }), { ...h });
    routeVaultEvent(event({ type: 'proposal_resolved' }), { ...h });
    expect(h.onPendingChanged).toHaveBeenCalledTimes(2);
    expect(h.onTreeChanged).not.toHaveBeenCalled();
  });
});

// Minimal EventSource stand-in the hook can drive.
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  static latest(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }

  emit(e: VaultEvent) {
    this.onmessage?.({ data: JSON.stringify(e) });
  }
}

describe('useVaultEvents', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('connects to /api/events and reports live status on open', () => {
    const { result } = renderHook(() => useVaultEvents({ openFilePath: 'open.md' }));
    expect(result.current.status).toBe('connecting');
    expect(MockEventSource.latest().url).toBe('/api/events');

    act(() => {
      MockEventSource.latest().onopen?.();
    });
    expect(result.current.status).toBe('live');
  });

  it('routes an open-file update to onOpenFileChanged and bumps activity', () => {
    const onOpenFileChanged = vi.fn();
    const onActivity = vi.fn();
    const onTreeChanged = vi.fn();

    renderHook(() =>
      useVaultEvents({ openFilePath: 'open.md', onOpenFileChanged, onActivity, onTreeChanged }),
    );

    act(() => {
      MockEventSource.latest().emit(event({ type: 'updated', path: 'open.md' }));
    });
    expect(onOpenFileChanged).toHaveBeenCalledWith('open.md');
    expect(onActivity).toHaveBeenCalledTimes(1);

    act(() => {
      MockEventSource.latest().emit(event({ type: 'created', path: 'fresh.md' }));
    });
    expect(onTreeChanged).toHaveBeenCalledTimes(1);
    expect(onOpenFileChanged).toHaveBeenCalledTimes(1); // not called again
  });

  it('flips to reconnecting on error', () => {
    const { result } = renderHook(() => useVaultEvents({ openFilePath: null }));
    act(() => {
      MockEventSource.latest().onerror?.();
    });
    expect(result.current.status).toBe('reconnecting');
  });
});
