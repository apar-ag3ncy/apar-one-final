'use client';

import {
  BuildingIcon,
  FileTextIcon,
  FolderKanbanIcon,
  ReceiptIcon,
  StoreIcon,
  UserIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EntityType, NavigationTarget } from './types';

const ICONS: Record<EntityType, typeof UserIcon> = {
  client: BuildingIcon,
  vendor: StoreIcon,
  employee: UserIcon,
  project: FolderKanbanIcon,
  transaction: ReceiptIcon,
  document: FileTextIcon,
};

export type EntityRefProps = {
  type: EntityType;
  id: string;
  label: string;
  /** Optional tab to land on. */
  tab?: string;
  /** Hide the leading icon. */
  hideIcon?: boolean;
  /**
   * The referenced entity has been archived or soft-deleted. When true we
   * append an "(ex-{type})" suffix in muted text so the row keeps reading
   * cleanly. The link itself stays clickable — the entity record still
   * exists, just not in the active directory.
   */
  archived?: boolean;
  /**
   * Navigation callback. If omitted, the component renders a non-interactive
   * span (read-only reference). Dashboard passes `(t) => router.push(...)`;
   * OS passes `(t) => openWindow(t)`.
   */
  onNavigate?: (target: NavigationTarget) => void;
  /** Provide a hover-card body (e.g. <EntityHoverCard />). */
  hoverBody?: React.ReactNode;
  className?: string;
};

const EX_SUFFIX: Record<EntityType, string> = {
  client: '(ex-client)',
  vendor: '(ex-vendor)',
  employee: '(former employee)',
  project: '(archived project)',
  transaction: '(reversed)',
  document: '(archived)',
};

/**
 * Inline reference to another entity (e.g. "Acme Co." inside a transaction row).
 *
 * Strict contract — this component runs in both Dashboard and OS:
 *   - No `next/navigation` imports. Navigation is dispatched via `onNavigate`.
 *   - No URL construction. The consumer translates `NavigationTarget` → URL or window.
 *
 * Without `onNavigate`: renders a non-interactive span so the same JSX is safe
 * in read-only contexts (e.g. printable reports).
 */
export function EntityRef({
  type,
  id,
  label,
  tab,
  hideIcon,
  archived,
  onNavigate,
  className,
}: EntityRefProps) {
  const Icon = ICONS[type];
  const target: NavigationTarget = { type, id, ...(tab !== undefined && { tab }) };
  const inner = (
    <>
      {!hideIcon ? <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden /> : null}
      <span className="truncate">
        {label}
        {archived ? <span className="text-muted-foreground ml-1">{EX_SUFFIX[type]}</span> : null}
      </span>
    </>
  );
  const base = 'inline-flex items-center gap-1.5 text-sm';

  if (!onNavigate) {
    return <span className={cn(base, 'text-foreground', className)}>{inner}</span>;
  }

  return (
    <button
      type="button"
      className={cn(
        base,
        'text-foreground hover:text-primary focus-visible:ring-ring rounded-sm outline-none hover:underline focus-visible:ring-2',
        className,
      )}
      onClick={() => onNavigate(target)}
    >
      {inner}
    </button>
  );
}
