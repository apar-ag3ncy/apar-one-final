'use client';

import * as React from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatINR } from '@/lib/money';
import { cn } from '@/lib/utils';

import type { BillingKpi, BillingKpiId } from './types';

export type KpiCardsProps = {
  kpis: BillingKpi[];
  loading?: boolean;
  /** Click → host opens the drilldown (filtered list, statement, etc.). */
  onCardClick?: (id: BillingKpiId) => void;
  className?: string;
};

/**
 * C1.9 — Compact KPI cards for the billing landing page.
 *
 * Six default cards (outstanding / oldest / avg days to pay / % in 90+ / this
 * month invoiced / this month received), each click-drillable. The host owns
 * what "drill" means — Dashboard navigates, OS opens a filtered window.
 *
 * Pre-gate: renders skeletons + a static frame so the layout is verifiable.
 */
export function KpiCards({ kpis, loading, onCardClick, className }: KpiCardsProps) {
  if (loading) {
    return (
      <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6', className)}>
      {kpis.map((kpi) => (
        <Card
          key={kpi.id}
          className={cn(onCardClick && 'cursor-pointer transition-shadow hover:shadow-md')}
          onClick={onCardClick ? () => onCardClick(kpi.id) : undefined}
          role={onCardClick ? 'button' : undefined}
          tabIndex={onCardClick ? 0 : undefined}
        >
          <CardContent className="p-4">
            <div className="text-muted-foreground text-xs">{kpi.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{renderKpiValue(kpi)}</div>
            {/* TODO(post-gate): trend arrow + delta-from-prior-period chip. */}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function renderKpiValue(kpi: BillingKpi): string {
  if (typeof kpi.value_paise === 'bigint') return formatINR(kpi.value_paise);
  if (typeof kpi.value_pct_bps === 'number') {
    return `${(kpi.value_pct_bps / 100).toFixed(1)}%`;
  }
  if (typeof kpi.value_days === 'number') return `${kpi.value_days}d`;
  return '—';
}
