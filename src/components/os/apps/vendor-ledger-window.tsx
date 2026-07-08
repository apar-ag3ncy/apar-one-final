'use client';

// Focused per-vendor ledger window — mirror of ClientLedgerWindow with
// vendor sub-ledger filter + AP-side balance convention (credit-adds,
// debit-subtracts so positive = we owe the vendor).

import { useEffect, useMemo, useState } from 'react';

import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { DateField as SharedDateField } from '@/components/shared/date-field';
import { exportSlug } from '@/lib/client/export-rows';
import { getVendorStatement, type Statement } from '@/lib/server/ledger/statements';
import { getVendor } from '@/lib/server-stub/entity-actions';
import { osActions } from '@/lib/os/store';

function currentFyDefaults(): { fromDate: string; toDate: string } {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    fromDate: `${fy}-04-01`,
    toDate: today.toISOString().slice(0, 10),
  };
}

export function VendorLedgerWindow({ vendorId }: { vendorId: string }) {
  const defaults = useMemo(() => currentFyDefaults(), []);
  const [fromDate, setFromDate] = useState<string>(defaults.fromDate);
  const [toDate, setToDate] = useState<string>(defaults.toDate);
  const [vendorName, setVendorName] = useState<string>('');
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVendor(vendorId)
      .then((v) => {
        if (!cancelled && v) setVendorName(v.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatement(null);
      setError(null);
    });
    getVendorStatement({ vendorId, from: fromDate, to: toDate })
      .then((s) => {
        if (!cancelled) setStatement(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load ledger');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId, fromDate, toDate]);

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
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            {vendorName || vendorId} — Ledger
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Every posting sub-ledgered to this vendor (Trade Payables 2110, Vendor Advances 1220,
            Vendor Costs 5100). Closing balance = what we owe them.
          </div>
        </div>
        <DateField label="From" value={fromDate} onChange={setFromDate} />
        <DateField label="To" value={toDate} onChange={setToDate} />
        <button
          type="button"
          className="btn"
          onClick={() =>
            osActions.openWindow({
              app: 'vendors',
              entityId: vendorId,
              title: vendorName || 'Vendor',
              position: 'beside-focused',
            })
          }
          title="Open the full vendor profile beside"
        >
          Open profile →
        </button>
      </header>

      {error ? (
        <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
      ) : (
        <StatementOfAccount
          statement={statement}
          noun="ledger entries"
          balanceMeaning="Positive = we owe the vendor (Trade Payables 2110)"
          rangeLabel={`${fromDate} → ${toDate}`}
          exportName={`vendor-ledger-${exportSlug(vendorName || vendorId)}-${fromDate}_to_${toDate}`}
          onSelectTransaction={(txnId) =>
            osActions.openWindow({
              app: 'transactions',
              entityId: txnId,
              title: 'Transaction',
              position: 'beside-focused',
            })
          }
        />
      )}
    </div>
  );
}

function DateField({
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
      <SharedDateField value={value} onChange={onChange} clearable={false} className="w-[150px]" />
    </label>
  );
}
