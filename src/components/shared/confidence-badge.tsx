import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'missing';

const COPY: Record<ConfidenceLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  missing: 'Missing',
};

const TONE: Record<ConfidenceLevel, string> = {
  high: 'bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900',
  medium:
    'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900',
  low: 'bg-red-100 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900',
  missing: 'bg-muted text-muted-foreground border-border dark:bg-muted dark:text-muted-foreground',
};

export function ConfidenceBadge({
  level,
  className,
  showLabel = true,
}: {
  level: ConfidenceLevel;
  className?: string;
  showLabel?: boolean;
}) {
  return (
    <Badge
      variant="outline"
      aria-label={`Extraction confidence: ${COPY[level]}`}
      className={cn('gap-1.5 px-2 py-0.5 text-xs font-medium', TONE[level], className)}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          level === 'high' && 'bg-emerald-600 dark:bg-emerald-400',
          level === 'medium' && 'bg-amber-600 dark:bg-amber-400',
          level === 'low' && 'bg-red-600 dark:bg-red-400',
          level === 'missing' && 'bg-muted-foreground',
        )}
      />
      {showLabel ? COPY[level] : null}
    </Badge>
  );
}
