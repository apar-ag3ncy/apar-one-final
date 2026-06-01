import { type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { cn } from '@/lib/utils';

type ChartCardProps = {
  title: string;
  description?: string;
  /** Header right-side controls (date range pickers, segmented controls, etc). */
  actions?: React.ReactNode;
  /** When true, replaces the chart area with a skeleton. */
  loading?: boolean;
  /** When true, replaces the chart area with an EmptyState. */
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  /** Fixed chart area height. Default 280px. */
  height?: number;
  children: React.ReactNode;
  className?: string;
};

export function ChartCard({
  title,
  description,
  actions,
  loading,
  empty,
  emptyTitle = 'No data yet',
  emptyDescription,
  emptyIcon,
  height = 280,
  children,
  className,
}: ChartCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="w-full" style={{ height }} />
        ) : empty ? (
          <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
        ) : (
          <div style={{ height }} className="w-full">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
