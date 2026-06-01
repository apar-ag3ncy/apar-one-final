'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import type { ActivityEvent } from '@/components/entity/activity-feed';

/**
 * Narrowed entity-type union for the activity log. Excludes 'transaction'
 * and 'document' from the broader UI EntityType since activity rows are
 * only keyed to principals. Mirrors the DB entity_type enum.
 */
export type ActivityFeedEntityType = 'client' | 'vendor' | 'employee' | 'project' | 'office';

export type UseRealtimeActivityOptions = {
  entityType: ActivityFeedEntityType;
  entityId: string;
  /**
   * Initial events (typically returned by the page's server component).
   * The hook starts subscribed and merges incremental inserts on top.
   */
  initial?: readonly ActivityEvent[];
  /**
   * Polling fallback interval in ms, used when realtime can't connect
   * (sandbox without websockets) and as a backstop for mention-based
   * events that the postgres_changes filter can't pick up. Default 15s
   * per SPEC-AMENDMENT-001 §4.2.
   */
  pollIntervalMs?: number;
  /**
   * Function that fetches the latest events for this entity. Called on
   * mount when `initial` is empty and on every poll tick. Typically
   * wraps `getEntityActivity` from `lib/server/entities/activity`.
   */
  fetchEvents?: (args: {
    entityType: ActivityFeedEntityType;
    entityId: string;
    sinceId?: string;
  }) => Promise<readonly ActivityEvent[]>;
};

export type UseRealtimeActivityResult = {
  events: readonly ActivityEvent[];
  /** True once the Supabase Realtime channel is subscribed. */
  isLive: boolean;
  /** Error message (transient — does not throw). */
  error: string | null;
};

type ActivityLogRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  kind: string;
  summary: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

function rowToEvent(row: ActivityLogRow): ActivityEvent {
  const payload = row.payload ?? {};
  return {
    id: row.id,
    kind: row.kind,
    at: row.created_at,
    actor: null, // realtime row doesn't carry the joined actor name; polling fills it in
    title: row.summary,
    body: typeof payload === 'object' && 'body' in payload ? (payload['body'] as string) : null,
    ref:
      typeof payload === 'object' && 'ref' in payload
        ? (payload['ref'] as ActivityEvent['ref'])
        : null,
  };
}

/**
 * Subscribes to an entity's activity stream and merges incremental events.
 *
 * Wire-up per SPEC-AMENDMENT-001 §4.2:
 *   - Supabase Realtime postgres_changes channel filtered by entity_id
 *     captures direct events instantly.
 *   - 15s polling backstop captures mention-based events (postgres_changes
 *     can't filter on JSONB containment) and serves as the connection
 *     fallback when Realtime can't reach the browser.
 *
 * The hook stays inside `lib/client/` (not `components/entity/`) so the
 * shared entity components remain transport-agnostic per Rule 47.
 */
export function useRealtimeActivity({
  entityType,
  entityId,
  initial = [],
  pollIntervalMs = 15_000,
  fetchEvents,
}: UseRealtimeActivityOptions): UseRealtimeActivityResult {
  const [events, setEvents] = useState<readonly ActivityEvent[]>(initial);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestIdRef = useRef<string | undefined>(events[0]?.id);

  // Keep latestIdRef in sync with current events so poll cursor advances.
  useEffect(() => {
    latestIdRef.current = events[0]?.id;
  }, [events]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let active = true;

    try {
      channel = supabase
        .channel(`entity-activity:${entityType}:${entityId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'entity_activity_log',
            filter: `entity_id=eq.${entityId}`,
          },
          (msg) => {
            const row = msg.new as ActivityLogRow;
            if (row.entity_type !== entityType) return;
            setEvents((current) => {
              if (current.some((e) => e.id === row.id)) return current;
              return [rowToEvent(row), ...current];
            });
          },
        )
        .subscribe((status) => {
          if (!active) return;
          if (status === 'SUBSCRIBED') setIsLive(true);
          if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsLive(false);
          }
        });
    } catch (e) {
      // Realtime client construction can fail in sandbox/no-websocket envs;
      // the polling backstop below will keep the feed alive. Schedule the
      // state writes off the effect tick to avoid the cascading-render lint.
      const msg = e instanceof Error ? e.message : 'Realtime subscribe failed';
      queueMicrotask(() => {
        if (!active) return;
        setIsLive(false);
        setError(msg);
      });
    }

    return () => {
      active = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [entityType, entityId]);

  // Polling backstop — runs whether or not Realtime is up. Catches mention
  // events that postgres_changes filters can't see, and refreshes actor
  // names on previously-inserted rows.
  useEffect(() => {
    if (!fetchEvents) return;
    let cancelled = false;

    async function tick() {
      try {
        const fresh = await fetchEvents!({
          entityType,
          entityId,
          sinceId: undefined, // refetch the full top page; merge by id
        });
        if (cancelled || fresh.length === 0) return;
        setEvents((current) => {
          const seen = new Set(current.map((e) => e.id));
          const additions = fresh.filter((e) => !seen.has(e.id));
          if (additions.length === 0) return current;
          return [...additions, ...current];
        });
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to refresh activity');
        }
      }
    }

    if (initial.length === 0) void tick();

    if (pollIntervalMs > 0) {
      const handle = setInterval(() => {
        void tick();
      }, pollIntervalMs);
      return () => {
        cancelled = true;
        clearInterval(handle);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, pollIntervalMs, fetchEvents, initial.length]);

  return { events, isLive, error };
}
