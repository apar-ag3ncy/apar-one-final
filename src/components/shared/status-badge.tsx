import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  success:
    'bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900',
  warning:
    'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900',
  danger:
    'bg-red-100 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900',
  info: 'bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-900',
  accent:
    'bg-violet-100 text-violet-900 border-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-900',
};

const DOT_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-emerald-600 dark:bg-emerald-400',
  warning: 'bg-amber-600 dark:bg-amber-400',
  danger: 'bg-red-600 dark:bg-red-400',
  info: 'bg-sky-600 dark:bg-sky-400',
  accent: 'bg-violet-600 dark:bg-violet-400',
};

type StatusBadgeProps = {
  label: string;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
};

export function StatusBadge({ label, tone = 'neutral', dot = true, className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 px-2 py-0.5 text-xs font-medium', TONE_CLASSES[tone], className)}
    >
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', DOT_CLASSES[tone])} /> : null}
      {label}
    </Badge>
  );
}
