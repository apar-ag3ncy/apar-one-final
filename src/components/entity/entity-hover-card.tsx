import { cn } from '@/lib/utils';

export type EntityHoverCardField = {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
};

export type EntityHoverCardProps = {
  title: string;
  subtitle?: string;
  fields?: readonly EntityHoverCardField[];
  footer?: React.ReactNode;
  className?: string;
};

/**
 * Compact entity preview card used in hover/popover contexts (e.g. when an
 * EntityRef is hovered in a long transaction list). Renders headline + a
 * key/value grid + optional footer (e.g. open-window button supplied by host).
 *
 * Pure dumb component. No data fetching. The consumer is expected to fetch
 * the preview via React Query and pass the resolved fields down.
 */
export function EntityHoverCard({
  title,
  subtitle,
  fields,
  footer,
  className,
}: EntityHoverCardProps) {
  return (
    <div
      className={cn(
        'bg-popover text-popover-foreground w-72 rounded-md border p-3 shadow-md',
        className,
      )}
    >
      <div className="space-y-0.5">
        <p className="leading-tight font-medium">{title}</p>
        {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
      </div>
      {fields && fields.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {fields.map((field) => (
            <div key={field.label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground tracking-wide uppercase">{field.label}</dt>
              <dd className={field.mono ? 'font-mono' : ''}>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {footer ? <div className="mt-3 border-t pt-2">{footer}</div> : null}
    </div>
  );
}
