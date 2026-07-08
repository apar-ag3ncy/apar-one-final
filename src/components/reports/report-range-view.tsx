'use client';

// Shared Dashboard renderer for date-range reports (Day Book, registers, GST,
// TDS, per-project P&L, cash flow, bank book…). The page supplies a column
// spec + a fetcher that returns already-computed rows (bigint money cells);
// this owns the From/To controls, loading/empty states, the shadcn table, and
// PDF/Excel export. Mirrors the OS report windows, shadcn-styled.

import { useEffect, useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { DateField } from '@/components/shared/date-field';
import { PageHeader } from '@/components/shared/page-header';
import { ExportMenu } from '@/components/shared/export-menu';
import { formatINR } from '@/components/shared/format-inr';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';

export type ReportCell = bigint | string | number | null | undefined;
export type ReportRow = Record<string, ReportCell>;
export type ReportColumn = { key: string; label: string; align?: 'right'; money?: boolean };
export type ReportPayload = { rows: ReportRow[]; totalRow?: ReportRow; note?: string };

export function currentFy(): { from: string; to: string } {
  const t = new Date();
  const fy = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
  return { from: `${fy}-04-01`, to: t.toISOString().slice(0, 10) };
}

function cellText(v: ReportCell, money?: boolean): string {
  if (v === null || v === undefined) return money ? '—' : '';
  if (money) return formatINR(typeof v === 'bigint' ? v : BigInt(Math.round(Number(v))));
  return String(v);
}

export function ReportRangeView({
  title,
  subtitle,
  columns,
  fetchData,
  exportName,
  sheetName,
  signedCols = [],
  extraControls,
  extraDeps = [],
}: {
  title: string;
  subtitle: string;
  columns: readonly ReportColumn[];
  fetchData: (from: string, to: string) => Promise<ReportPayload>;
  exportName: string;
  sheetName: string;
  signedCols?: readonly string[];
  extraControls?: React.ReactNode;
  extraDeps?: readonly unknown[];
}) {
  const fy = currentFy();
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setData(null);
      setError(null);
    });
    fetchData(from, to)
      .then((d) => !cancelled && setData(d))
      .catch(
        (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, ...extraDeps]);

  function handleExport(format: ExportFormat) {
    if (!data) return;
    const headers = columns.map((c) => c.label);
    const toRow = (r: ReportRow): Record<string, string | number> => {
      const o: Record<string, string | number> = {};
      for (const c of columns) {
        const v = r[c.key];
        if (c.money) o[c.label] = typeof v === 'bigint' ? paiseToRupees(v) : Number(v ?? 0);
        else o[c.label] = v === null || v === undefined ? '' : String(v);
      }
      return o;
    };
    const rows = data.rows.map(toRow);
    if (data.totalRow) rows.push(toRow(data.totalRow));
    const columnFormats: Record<string, string> = {};
    for (const key of signedCols) {
      const col = columns.find((c) => c.key === key);
      if (col) columnFormats[col.label] = '+#,##0.00;-#,##0.00;0.00';
    }
    exportRows(rows, headers, `${exportName}-${from}-to-${to}`, format, sheetName, {
      columnFormats,
    });
  }

  const isEmpty = !!data && data.rows.length === 0;

  return (
    <>
      <PageHeader title={title} description={subtitle} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-muted-foreground text-xs tracking-wide uppercase">From</Label>
          <DateField value={from} onChange={setFrom} clearable={false} className="w-44" />
        </div>
        <div>
          <Label className="text-muted-foreground text-xs tracking-wide uppercase">To</Label>
          <DateField value={to} onChange={setTo} clearable={false} className="w-44" />
        </div>
        {extraControls}
        <div className="ml-auto">
          <ExportMenu onExport={handleExport} disabled={!data || isEmpty} />
        </div>
      </div>

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : !data ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : isEmpty ? (
        <p className="text-muted-foreground text-sm">No data in this range.</p>
      ) : (
        <>
          {data.note ? <p className="text-muted-foreground text-xs">{data.note}</p> : null}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {columns.map((c) => (
                    <TableHead key={c.key} className={c.align === 'right' ? 'text-right' : ''}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={
                          (c.align === 'right' ? 'text-right ' : '') +
                          (c.money ? 'font-mono tabular-nums' : '')
                        }
                      >
                        {cellText(r[c.key], c.money)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {data.totalRow ? (
                  <TableRow className="border-t-2 font-semibold">
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={
                          (c.align === 'right' ? 'text-right ' : '') +
                          (c.money ? 'font-mono tabular-nums' : '')
                        }
                      >
                        {cellText(data.totalRow![c.key], c.money)}
                      </TableCell>
                    ))}
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
