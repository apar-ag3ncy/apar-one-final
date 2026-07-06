'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ArrowRightIcon, LandmarkIcon, PencilIcon, PlusIcon } from 'lucide-react';

import { formatINR } from '@/components/shared/format-inr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { rupeesToPaise, paiseToRupees } from '@/lib/money';
import {
  type AgencyBankDetail,
  createAgencyBankAccount,
  updateAgencyBankAccount,
} from '@/lib/server/billing/agency-banks';

const ACCOUNT_TYPES = [
  { value: 'current', label: 'Current' },
  { value: 'savings', label: 'Savings' },
  { value: 'od', label: 'Overdraft (OD)' },
  { value: 'escrow', label: 'Escrow' },
] as const;

type FormState = {
  displayName: string;
  bankName: string;
  branch: string;
  accountLast4: string;
  ifsc: string;
  accountType: (typeof ACCOUNT_TYPES)[number]['value'];
  openingRupees: string;
  openingBalanceDate: string;
  isActive: boolean;
  notes: string;
};

const EMPTY: FormState = {
  displayName: '',
  bankName: '',
  branch: '',
  accountLast4: '',
  ifsc: '',
  accountType: 'current',
  openingRupees: '',
  openingBalanceDate: '',
  isActive: true,
  notes: '',
};

function fromBank(b: AgencyBankDetail): FormState {
  return {
    displayName: b.displayName,
    bankName: b.bankName,
    branch: b.branch ?? '',
    accountLast4: b.accountLast4,
    ifsc: b.ifsc,
    accountType: b.accountType,
    openingRupees: b.openingBalancePaise === 0n ? '' : paiseToRupees(b.openingBalancePaise),
    openingBalanceDate: b.openingBalanceDate ?? '',
    isActive: b.isActive,
    notes: b.notes ?? '',
  };
}

export function BankAccountsManager({ banks }: { banks: readonly AgencyBankDetail[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<null | { id: string | null; form: FormState }>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {banks.length} account{banks.length === 1 ? '' : 's'}
        </p>
        <Button size="sm" onClick={() => setEditing({ id: null, form: EMPTY })}>
          <PlusIcon className="size-4" /> Add bank account
        </Button>
      </div>

      {banks.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No bank accounts yet. Add one and set its opening balance to start tallying.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {banks.map((b) => (
            <Card key={b.id} className="overflow-hidden">
              <CardContent className="space-y-3 py-4">
                <div className="flex items-start gap-3">
                  <LandmarkIcon className="mt-0.5 size-5 opacity-70" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium break-words [overflow-wrap:anywhere]">
                        {b.displayName}
                      </p>
                      {!b.isActive && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {b.bankName} · ••{b.accountLast4} · {b.accountType.toUpperCase()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit"
                    onClick={() => setEditing({ id: b.id, form: fromBank(b) })}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                </div>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-muted-foreground text-xs">Current balance</p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatINR(b.currentBalancePaise)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground text-xs">Opening</p>
                    <p className="text-sm tabular-nums">
                      {formatINR(b.openingBalancePaise)}
                      {b.openingBalanceDate ? (
                        <span className="text-muted-foreground"> · {b.openingBalanceDate}</span>
                      ) : null}
                    </p>
                  </div>
                </div>

                <Link
                  href={`/banking/${b.id}`}
                  className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Open bank book <ArrowRightIcon className="size-3.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <BankDialog
          id={editing.id}
          initial={editing.form}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BankDialog({
  id,
  initial,
  onClose,
  onSaved,
}: {
  id: string | null;
  initial: FormState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setError(null);
    let openingBalancePaise = 0n;
    const trimmedOpening = form.openingRupees.trim();
    if (trimmedOpening !== '') {
      try {
        openingBalancePaise = rupeesToPaise(trimmedOpening);
      } catch {
        setError('Opening balance must be a number like 250000 or -1200.50.');
        return;
      }
      if (!form.openingBalanceDate) {
        setError('Pick the date this opening balance was true.');
        return;
      }
    }
    if (!form.displayName.trim() || !form.bankName.trim() || !form.ifsc.trim()) {
      setError('Name, bank and IFSC are required.');
      return;
    }
    if (!/^\d{2,8}$/.test(form.accountLast4.trim())) {
      setError('Account last digits should be 2–8 numbers.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        displayName: form.displayName.trim(),
        bankName: form.bankName.trim(),
        branch: form.branch.trim() || null,
        accountLast4: form.accountLast4.trim(),
        ifsc: form.ifsc.trim().toUpperCase(),
        accountType: form.accountType,
        openingBalancePaise,
        openingBalanceDate: trimmedOpening === '' ? null : form.openingBalanceDate,
        isActive: form.isActive,
        notes: form.notes.trim() || null,
      };
      if (id) {
        await updateAgencyBankAccount({ ...payload, id });
      } else {
        await createAgencyBankAccount(payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the bank account.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="os-modal-overlay"
      style={modalOverlayStyle}
      onMouseDown={onClose}
      role="presentation"
    >
      <div className="os-modal" style={modalBoxStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head" style={modalHeadStyle}>
          <strong>{id ? 'Edit bank account' : 'Add bank account'}</strong>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div style={{ overflowY: 'auto', padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Account name">
              <input
                style={osInputStyle}
                value={form.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                placeholder="e.g. HDFC Current"
              />
            </Field>
            <Field label="Bank">
              <input
                style={osInputStyle}
                value={form.bankName}
                onChange={(e) => set('bankName', e.target.value)}
                placeholder="HDFC Bank"
              />
            </Field>
            <Field label="Branch (optional)">
              <input
                style={osInputStyle}
                value={form.branch}
                onChange={(e) => set('branch', e.target.value)}
              />
            </Field>
            <Field label="Account last digits">
              <input
                style={osInputStyle}
                value={form.accountLast4}
                onChange={(e) => set('accountLast4', e.target.value)}
                placeholder="1234"
                inputMode="numeric"
              />
            </Field>
            <Field label="IFSC">
              <input
                style={osInputStyle}
                value={form.ifsc}
                onChange={(e) => set('ifsc', e.target.value)}
                placeholder="HDFC0000123"
              />
            </Field>
            <Field label="Type">
              <select
                style={osInputStyle}
                value={form.accountType}
                onChange={(e) => set('accountType', e.target.value as FormState['accountType'])}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: '1fr 1fr',
              borderTop: '1px solid var(--border, #e5e7eb)',
              paddingTop: 14,
            }}
          >
            <Field label="Opening balance (₹)">
              <input
                style={osInputStyle}
                value={form.openingRupees}
                onChange={(e) => set('openingRupees', e.target.value)}
                placeholder="250000"
                inputMode="decimal"
                id="bank-opening"
              />
            </Field>
            <Field label="As of date">
              <input
                type="date"
                style={osInputStyle}
                value={form.openingBalanceDate}
                onChange={(e) => set('openingBalanceDate', e.target.value)}
                id="bank-opening-date"
              />
            </Field>
          </div>
          <p className="os-field-hint" style={{ fontSize: 12, opacity: 0.7, marginTop: -4 }}>
            How much was in this account on that date. We post it as an opening journal entry so the
            ledger and the bank book both tally from there. Use a negative amount for an overdraft.
          </p>

          <Field label="Notes (optional)">
            <input
              style={osInputStyle}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            Active (show in payment pickers)
          </label>

          {error && (
            <p style={{ color: 'var(--destructive, #dc2626)', fontSize: 13 }} role="alert">
              {error}
            </p>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '14px 18px',
            borderTop: '1px solid var(--border, #e5e7eb)',
          }}
        >
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Saving…' : id ? 'Save changes' : 'Add account'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="os-field" style={{ display: 'grid', gap: 4 }}>
      <span className="os-field-label" style={{ fontSize: 12, opacity: 0.75 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(15, 23, 42, 0.45)',
};

const modalBoxStyle: React.CSSProperties = {
  width: 680,
  maxWidth: '95vw',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--popover, #ffffff)',
  color: 'var(--popover-foreground, #0f172a)',
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 12,
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.32)',
};

const modalHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 18px',
  borderBottom: '1px solid var(--border, #e5e7eb)',
};

const osInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--content, var(--background, #ffffff))',
  color: 'var(--text, var(--foreground, inherit))',
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 7,
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};
