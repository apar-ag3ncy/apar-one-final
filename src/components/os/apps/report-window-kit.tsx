'use client';

// Shared building blocks for the native OS report windows (Trial Balance,
// Balance Sheet, P&L, AR/AP Aging, Statement, Cash Flow). These render the
// same live ledger data the dashboard /reports/* routes use, but inside OS
// window chrome — OS-native styling only (`.main`, `.table`, `.btn`,
// CSS variables), no shadcn and no next/navigation router.

import { useEffect, useState } from 'react';
import { exportRows, type ExportFormat } from '@/lib/client/export-rows';

export { exportRows };
export type { ExportFormat };

/** Indian FY (Apr 1 → today, IST-ish) used as the default date range. */
export function currentFyDefaults(): { fromDate: string; toDate: string } {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    fromDate: `${fy}-04-01`,
    toDate: today.toISOString().slice(0, 10),
  };
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetch report data with the standard OS-window lifecycle: reset to a
 * loading state, refetch when `deps` change, ignore stale resolutions, and
 * surface errors. Mirrors the hand-rolled effect in per-client-pnl-window.
 */
export function useReportData<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // queueMicrotask so the pending-state reset doesn't run synchronously
    // inside the effect body (react-hooks no-sync-render rule).
    queueMicrotask(() => {
      if (cancelled) return;
      setData(null);
      setError(null);
    });
    fetcher()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load report');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--content-2)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 12,
          color: 'var(--text)',
        }}
      />
    </label>
  );
}

/** OS-native PDF + Excel export buttons. */
export function OsExportButtons({
  onExport,
  disabled,
}: {
  onExport: (format: ExportFormat) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        type="button"
        className="btn"
        onClick={() => onExport('pdf')}
        disabled={disabled}
        title="Download this report as a PDF file"
      >
        Export PDF
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => onExport('xlsx')}
        disabled={disabled}
        title="Download this report as an Excel (.xlsx) file"
      >
        Export Excel
      </button>
    </div>
  );
}

/**
 * Standard report-window shell: a title/subtitle header with a controls slot,
 * then a scrolling body that renders loading / error / empty / content states.
 * The root is `.main` (flex column) so the OS `.window-body` delegates scroll
 * to the inner `overflow:auto` region — content is never clipped.
 */
export function ReportWindowFrame({
  title,
  subtitle,
  controls,
  loading,
  error,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  subtitle?: string;
  controls?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  isEmpty?: boolean;
  emptyText?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="main"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 18, gap: 14 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            {title}
          </div>
          {subtitle ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>
          ) : null}
        </div>
        {controls}
      </header>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {error ? (
          <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
        ) : loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
        ) : isEmpty ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {emptyText ?? 'No data in this range.'}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
