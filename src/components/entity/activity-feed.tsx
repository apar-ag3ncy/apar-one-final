'use client';

import { useMemo, useState } from 'react';
import {
  ActivityIcon,
  CheckCircle2Icon,
  FileEditIcon,
  FileTextIcon,
  MessageSquareIcon,
  PhoneCallIcon,
  PlusCircleIcon,
  ReceiptIcon,
  UserPlusIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { cn } from '@/lib/utils';
import { EntityRef } from './entity-ref';
import type { NavigationTarget } from './types';

/**
 * Activity event kinds. Open union — backend can add new kinds and the UI
 * falls back to a generic icon.
 */
export type ActivityKind =
  | 'note'
  | 'call'
  | 'meeting'
  | 'email'
  | 'document_uploaded'
  | 'document_signed'
  | 'contact_added'
  | 'transaction_posted'
  | 'transaction_reversed'
  | 'entity_created'
  | 'entity_archived'
  | 'field_edited'
  | (string & {});

export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  /** ISO timestamp. */
  at: string | Date;
  /** Display name of the actor (e.g. "Apar Agarwal"). */
  actor?: string | null;
  /** Headline ("Logged a call with Acme — 12 min"). */
  title: string;
  /** Optional body (rendered as smaller text below the title). */
  body?: string | null;
  /** Optional reference to another entity (e.g. the transaction this points to). */
  ref?: {
    type: 'client' | 'vendor' | 'employee' | 'project' | 'transaction' | 'document';
    id: string;
    label: string;
  } | null;
};

const ICONS: Record<string, typeof ActivityIcon> = {
  note: MessageSquareIcon,
  call: PhoneCallIcon,
  meeting: PhoneCallIcon,
  email: FileEditIcon,
  document_uploaded: FileTextIcon,
  document_signed: CheckCircle2Icon,
  contact_added: UserPlusIcon,
  transaction_posted: ReceiptIcon,
  transaction_reversed: ReceiptIcon,
  entity_created: PlusCircleIcon,
  entity_archived: FileEditIcon,
  field_edited: FileEditIcon,
};

export type ActivityFeedProps = {
  events: readonly ActivityEvent[];
  /** Optional "live" indicator — when true, shows a dot in the header. */
  isLive?: boolean;
  /** Available kind filters (auto-derived from `events` if omitted). */
  availableKinds?: readonly ActivityKind[];
  onNavigate?: (target: NavigationTarget) => void;
  /** Render a header with "Live" indicator and kind chips. Defaults to true. */
  showHeader?: boolean;
  /** Click "Log activity" CTA. */
  onLogActivity?: () => void;
  className?: string;
};

/**
 * Chronological event feed for an entity. Groups by day; clicking an event
 * with a `ref` calls `onNavigate`.
 *
 * Realtime subscription is intentionally OUT of scope here — the consumer
 * decides whether to use Supabase Realtime, polling, or static SSR. Dashboard
 * Phase 3 will pair this component with a `useRealtimeActivity` hook that
 * lives in `lib/client/`, never inside the entity tree.
 */
export function ActivityFeed({
  events,
  isLive,
  availableKinds,
  onNavigate,
  showHeader = true,
  onLogActivity,
  className,
}: ActivityFeedProps) {
  const [filterKind, setFilterKind] = useState<ActivityKind | 'all'>('all');

  const kinds = useMemo<readonly ActivityKind[]>(() => {
    if (availableKinds) return availableKinds;
    return Array.from(new Set(events.map((e) => e.kind)));
  }, [events, availableKinds]);

  const filtered = useMemo(() => {
    if (filterKind === 'all') return events;
    return events.filter((e) => e.kind === filterKind);
  }, [events, filterKind]);

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  if (events.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="No activity yet"
        description="Calls, meetings, notes, document uploads, and posted transactions land here in chronological order."
      />
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {showHeader ? (
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Activity</h3>
            {isLive ? (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <span className="inline-block size-2 animate-pulse rounded-full bg-emerald-500" />
                Live
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <KindChip
              label="All"
              active={filterKind === 'all'}
              onClick={() => setFilterKind('all')}
            />
            {kinds.map((kind) => (
              <KindChip
                key={kind}
                label={prettyKind(kind)}
                active={filterKind === kind}
                onClick={() => setFilterKind(kind)}
              />
            ))}
            {onLogActivity ? (
              <button
                type="button"
                onClick={onLogActivity}
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-2.5 py-1 text-xs"
              >
                Log activity
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      <ol className="flex flex-col gap-6">
        {grouped.map((group) => (
          <li key={group.day} className="flex flex-col gap-3">
            <h4 className="text-muted-foreground sticky top-0 text-xs tracking-wide uppercase">
              {group.label}
            </h4>
            <ol className="flex flex-col gap-3">
              {group.events.map((ev) => (
                <ActivityRow key={ev.id} event={ev} onNavigate={onNavigate} />
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ActivityRow({
  event,
  onNavigate,
}: {
  event: ActivityEvent;
  onNavigate?: (target: NavigationTarget) => void;
}) {
  const Icon = ICONS[event.kind] ?? ActivityIcon;
  return (
    <li className="flex gap-3">
      <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
        <Icon className="size-3.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {event.actor ? <span className="font-medium">{event.actor}</span> : null}
          {event.actor ? ' · ' : ''}
          {event.title}
        </p>
        {event.body ? (
          <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">{event.body}</p>
        ) : null}
        {event.ref ? (
          <div className="mt-1">
            <EntityRef
              type={event.ref.type}
              id={event.ref.id}
              label={event.ref.label}
              onNavigate={onNavigate}
              hideIcon
              className="text-xs"
            />
          </div>
        ) : null}
        <p className="text-muted-foreground mt-1 text-xs">{formatTime(event.at)}</p>
      </div>
    </li>
  );
}

function KindChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

function groupByDay(events: readonly ActivityEvent[]) {
  const map = new Map<string, { label: string; events: ActivityEvent[] }>();
  for (const ev of events) {
    const d = typeof ev.at === 'string' ? new Date(ev.at) : ev.at;
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    if (!map.has(key)) map.set(key, { label, events: [] });
    map.get(key)!.events.push(ev);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, value]) => ({ day, label: value.label, events: value.events }));
}

function formatTime(at: string | Date): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function prettyKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
