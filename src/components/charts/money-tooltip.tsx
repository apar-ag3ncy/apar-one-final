'use client';

import { formatINR } from '@/components/shared/format-inr';

type TooltipPayloadItem = {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | bigint;
  color?: string;
};

export type MoneyTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadItem[];
  /**
   * Multiplier applied to numeric values before formatting as paise.
   * Default 1 (values are already paise). Use 100 if data is rupees.
   */
  multiplier?: number;
};

function toPaise(value: number | string | bigint | undefined, multiplier: number): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * multiplier));
}

export function MoneyTooltip({ active, label, payload, multiplier = 1 }: MoneyTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
      {label !== undefined ? <div className="mb-1 font-medium">{String(label)}</div> : null}
      <ul className="space-y-1">
        {payload.map((item, idx) => {
          const paise = toPaise(item.value, multiplier);
          return (
            <li key={idx} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">
                {String(item.name ?? item.dataKey ?? '')}
              </span>
              <span className="ml-auto tabular-nums">
                {paise === null ? '—' : formatINR(paise)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
