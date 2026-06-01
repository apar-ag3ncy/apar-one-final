'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatINRCompact } from '@/components/shared/format-inr';
import { MoneyTooltip } from './money-tooltip';

export type MoneyLineSeries = {
  dataKey: string;
  name: string;
  color?: string;
};

type Props<TDatum> = {
  data: readonly TDatum[];
  xKey: keyof TDatum & string;
  series: readonly MoneyLineSeries[];
  /** Pass 100 if the data is rupees (number) rather than paise. Default 1. */
  multiplier?: number;
};

export function MoneyLineChart<TDatum extends Record<string, unknown>>({
  data,
  xKey,
  series,
  multiplier = 1,
}: Props<TDatum>) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data as TDatum[]} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
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
          cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
          content={<MoneyTooltip multiplier={multiplier} />}
        />
        {series.map((s, idx) => (
          <Line
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.color ?? `var(--chart-${(idx % 5) + 1})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
