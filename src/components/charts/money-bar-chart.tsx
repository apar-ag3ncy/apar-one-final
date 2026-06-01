'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatINRCompact } from '@/components/shared/format-inr';
import { MoneyTooltip } from './money-tooltip';

export type MoneyBarSeries = {
  /** Field name in the data row whose value is paise (bigint or number-of-paise). */
  dataKey: string;
  /** Display name shown in tooltip + legend. */
  name: string;
  /** Bar fill colour. Default uses the chart-1 token. */
  color?: string;
};

type Props<TDatum> = {
  data: readonly TDatum[];
  /** Field name in the data row that drives the x-axis category. */
  xKey: keyof TDatum & string;
  series: readonly MoneyBarSeries[];
  /** Pass 100 if the data is rupees (number) rather than paise (bigint/number). Default 1. */
  multiplier?: number;
  /** Stack bars on the same X tick. */
  stacked?: boolean;
};

export function MoneyBarChart<TDatum extends Record<string, unknown>>({
  data,
  xKey,
  series,
  multiplier = 1,
  stacked,
}: Props<TDatum>) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data as TDatum[]} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey={xKey as string}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
          tickFormatter={(value: number) =>
            formatINRCompact(BigInt(Math.round(value * multiplier)))
          }
          width={70}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
          content={<MoneyTooltip multiplier={multiplier} />}
        />
        {series.map((s, idx) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name}
            fill={s.color ?? `var(--chart-${(idx % 5) + 1})`}
            radius={[4, 4, 0, 0]}
            stackId={stacked ? 'stack' : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
