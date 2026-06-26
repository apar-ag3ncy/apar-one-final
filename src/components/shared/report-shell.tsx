'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ExportMenu } from '@/components/shared/export-menu';
import type { ExportFormat } from '@/lib/client/export-rows';

export type ReportShellProps = {
  /** As-of date in YYYY-MM-DD. */
  asOfDate: string;
  /** Optional include-reversed toggle. */
  includeReversed?: boolean;
  /** Show the include-reversed toggle. */
  showIncludeReversed?: boolean;
  /** Base path for URL updates. */
  basePath: string;
  /** Optional exporter — renders an Export (PDF / Excel) menu when provided. */
  onExport?: (format: ExportFormat) => void;
  children: React.ReactNode;
};

/**
 * Shared filter strip + container for standard reports (Trial Balance, P&L,
 * Balance Sheet, AR/AP aging, Bank book, Cash flow). Each report passes its
 * own table body as children; this just unifies the controls.
 */
export function ReportShell({
  asOfDate,
  includeReversed,
  showIncludeReversed,
  basePath,
  onExport,
  children,
}: ReportShellProps) {
  const router = useRouter();

  function apply(params: { asOf?: string; includeReversed?: boolean }) {
    const next = new URLSearchParams();
    next.set('asOf', params.asOf ?? asOfDate);
    if ((params.includeReversed ?? includeReversed) === true) {
      next.set('includeReversed', '1');
    }
    router.push(`${basePath}?${next.toString()}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-3 pb-3">
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">As-of</Label>
            <Input
              type="date"
              defaultValue={asOfDate}
              onChange={(e) => apply({ asOf: e.target.value })}
              className="w-44"
            />
          </div>
          {showIncludeReversed ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={Boolean(includeReversed)}
                onCheckedChange={(c) => apply({ includeReversed: Boolean(c) })}
              />
              Include reversed
            </label>
          ) : null}
          {onExport ? (
            <div className="ml-auto">
              <ExportMenu onExport={onExport} />
            </div>
          ) : null}
        </CardHeader>
      </Card>
      <Card>
        <CardContent className="p-0">{children}</CardContent>
      </Card>
    </div>
  );
}
