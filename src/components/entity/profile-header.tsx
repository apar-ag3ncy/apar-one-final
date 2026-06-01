import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import type { BackTarget } from './types';

export type ProfileHeaderProps = {
  /** Entity display name shown as the H1. */
  title: string;
  /** Optional supporting line (industry · city · owner, etc.). */
  subtitle?: React.ReactNode;
  /** Status badge shown beside the title. */
  status?: { tone: StatusTone; label: string };
  /** Back-link or back-button. Dashboard passes href; OS passes onClick. */
  back?: BackTarget;
  /** Right-aligned actions (Edit, Log activity, etc.). */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Surface-agnostic entity profile header.
 *
 * Replaces the ad-hoc header markup in Dashboard's `app/(app)/<entity>/[id]/page.tsx`
 * and is consumed by OS as the title bar for entity windows.
 *
 * Rules (Rule 47, components/entity contract):
 *   - No `next/navigation` imports. Back navigation goes through the `back`
 *     prop, which is either `{ href, label }` (Dashboard uses an <a>) or
 *     `{ onClick, label }` (OS swaps to a button).
 *   - No Supabase or server-action imports.
 */
export function ProfileHeader({
  title,
  subtitle,
  status,
  back,
  actions,
  className,
}: ProfileHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 pb-6', className)}>
      {back ? <ProfileBackLink back={back} /> : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
            {status ? <StatusBadge tone={status.tone} label={status.label} /> : null}
          </div>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

function ProfileBackLink({ back }: { back: BackTarget }) {
  const inner = (
    <>
      <ArrowLeftIcon className="size-4" aria-hidden />
      {back.label}
    </>
  );
  if ('href' in back) {
    return (
      <Button asChild variant="ghost" size="sm" className="gap-1.5 self-start px-2">
        <a href={back.href}>{inner}</a>
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1.5 self-start px-2"
      onClick={back.onClick}
    >
      {inner}
    </Button>
  );
}
