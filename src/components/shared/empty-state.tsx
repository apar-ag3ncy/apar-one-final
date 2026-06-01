import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border/60 bg-card/30 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <div
          className="bg-muted text-muted-foreground mb-4 flex size-12 items-center justify-center rounded-full"
          aria-hidden
        >
          <Icon className="size-6" />
        </div>
      ) : null}
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-md text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
