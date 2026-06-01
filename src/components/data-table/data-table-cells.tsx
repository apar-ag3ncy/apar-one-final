import { format, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { ConfidenceBadge, type ConfidenceLevel } from '@/components/shared/confidence-badge';
import { formatINR } from '@/components/shared/format-inr';

export function MoneyCell({
  paise,
  className,
  emptyDash = true,
}: {
  paise: bigint | null | undefined;
  className?: string;
  emptyDash?: boolean;
}) {
  if (paise === null || paise === undefined) {
    return (
      <span className={cn('text-muted-foreground tabular-nums', className)}>
        {emptyDash ? '—' : ''}
      </span>
    );
  }
  return <span className={cn('tabular-nums', className)}>{formatINR(paise)}</span>;
}

// TODO(backend): swap format() for formatDateIST() from @/lib/date when Backend ships it,
// so dates render in IST regardless of viewer timezone.
export function DateCell({
  value,
  fmt = 'dd MMM yyyy',
  className,
}: {
  value: Date | string | number | null | undefined;
  fmt?: string;
  className?: string;
}) {
  if (value === null || value === undefined) {
    return <span className={cn('text-muted-foreground tabular-nums', className)}>—</span>;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!isValid(date)) {
    return <span className={cn('text-muted-foreground tabular-nums', className)}>—</span>;
  }
  return <span className={cn('tabular-nums', className)}>{format(date, fmt)}</span>;
}

export function ConfidenceCell({ level }: { level: ConfidenceLevel }) {
  return <ConfidenceBadge level={level} />;
}
