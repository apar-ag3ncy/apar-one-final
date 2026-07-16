'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { MoneyTooltip } from './money-tooltip';

export type MoneyPieDatum = {
  /** Slice label shown in the legend + tooltip. */
  name: string;
  /** Slice value in paise (already a number-of-paise). */
  paise: number;
};

type Props = {
  data: readonly MoneyPieDatum[];
};

/**
 * Donut breakdown of a money total by category. Slices cycle the five chart
 * tokens (`--chart-1`…`--chart-5`); the tooltip reuses the shared MoneyTooltip
 * so hover values format as INR. Mirrors the MoneyBarChart / MoneyLineChart
 * API — values are paise, formatted downstream.
 */
export function MoneyPieChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <Pie
          data={data as MoneyPieDatum[]}
          dataKey="paise"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="45%"
          outerRadius="72%"
          paddingAngle={1}
          stroke="var(--background)"
        >
          {data.map((entry, idx) => (
            <Cell key={entry.name} fill={`var(--chart-${(idx % 5) + 1})`} />
          ))}
        </Pie>
        <Tooltip content={<MoneyTooltip />} />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
