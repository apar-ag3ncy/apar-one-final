'use client';

import { AlertTriangleIcon, BanIcon, InfoIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/shared/status-badge';
import type { TransactionFlag } from './transaction-detail';

export type ValidationFlagsProps = {
  flags: readonly TransactionFlag[];
  acknowledgedIds: ReadonlySet<string>;
  onAcknowledgeToggle: (flagId: string) => void;
  className?: string;
};

/**
 * Inline validation panel rendered on transaction draft forms. Server returns
 * flags after `createDraftTransaction`; the UI surfaces them here.
 *
 *  - `block` severity prevents posting (Post button disabled).
 *  - `warn` severity allows posting after an Acknowledge toggle.
 *  - `info` severity is FYI only.
 */
export function ValidationFlags({
  flags,
  acknowledgedIds,
  onAcknowledgeToggle,
  className,
}: ValidationFlagsProps) {
  if (flags.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
          <InfoIcon className="size-4 opacity-60" aria-hidden />
          No validation flags. Ready to post.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Validation flags</CardTitle>
        <p className="text-muted-foreground text-xs">
          {flags.filter((f) => f.severity === 'block').length} blocking ·{' '}
          {flags.filter((f) => f.severity === 'warn').length} warning ·{' '}
          {flags.filter((f) => f.severity === 'info').length} info
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {flags.map((flag) => (
          <FlagRow
            key={flag.id}
            flag={flag}
            acknowledged={acknowledgedIds.has(flag.id)}
            onToggle={() => onAcknowledgeToggle(flag.id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function FlagRow({
  flag,
  acknowledged,
  onToggle,
}: {
  flag: TransactionFlag;
  acknowledged: boolean;
  onToggle: () => void;
}) {
  const Icon =
    flag.severity === 'block' ? BanIcon : flag.severity === 'warn' ? AlertTriangleIcon : InfoIcon;
  const tone = flag.severity === 'block' ? 'danger' : flag.severity === 'warn' ? 'warning' : 'info';
  return (
    <div className="flex items-start gap-3 border-t pt-3 first:border-t-0 first:pt-0">
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${
          flag.severity === 'block'
            ? 'text-destructive'
            : flag.severity === 'warn'
              ? 'text-amber-500'
              : 'text-muted-foreground'
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={tone} label={flag.severity.toUpperCase()} dot={false} />
          <span className="font-mono text-xs">{flag.code}</span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{flag.message}</p>
      </div>
      {flag.severity === 'warn' ? (
        <label className="flex shrink-0 items-center gap-2 text-xs">
          <Checkbox checked={acknowledged} onCheckedChange={onToggle} />
          <Label className="text-xs">Acknowledge</Label>
        </label>
      ) : null}
    </div>
  );
}
