'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { rupeesToPaise } from '@/lib/money';
import {
  listAgencyBankAccounts,
  type AgencyBankAccountRow,
} from '@/lib/server/billing/agency-banks';
import {
  issueVendorDebitNote,
  recordVendorAdvance,
} from '@/lib/server/billing/vendor-adjustments';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseRupees(s: string): bigint | null {
  const t = s.replace(/[,\s]/g, '').trim();
  if (t === '') return 0n;
  try {
    return rupeesToPaise(t);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Vendor advance                                                              */
/* -------------------------------------------------------------------------- */

export function VendorAdvanceDialog({
  open,
  onOpenChange,
  vendorId,
  vendorName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
  onDone: () => void;
}) {
  const [banks, setBanks] = useState<readonly AgencyBankAccountRow[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    listAgencyBankAccounts()
      .then((b) => {
        setBanks(b);
        const first = b.find((x) => x.isActive) ?? b[0];
        if (first) setBankAccountId(first.id);
      })
      .catch(() => setBanks([]));
  }, [open]);

  function submit() {
    const paise = parseRupees(amount);
    if (paise === null || paise <= 0n) {
      toast.error('Enter a valid amount.');
      return;
    }
    if (!bankAccountId) {
      toast.error('Pick the bank account the advance was paid from.');
      return;
    }
    startTransition(async () => {
      const res = await recordVendorAdvance({
        vendorId,
        bankAccountId,
        amountPaise: paise,
        txnDate: date,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success('Vendor advance recorded.');
      setAmount('');
      setNotes('');
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record vendor advance</DialogTitle>
          <DialogDescription>
            Money paid to {vendorName} before a bill. Posts Dr Advances to Vendors / Cr Bank.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="adv-bank">From bank account</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger id="adv-bank">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label} ••{b.accountLast4}
                    {b.isActive ? '' : ' (inactive)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="adv-amt">Amount ₹</Label>
              <Input
                id="adv-amt"
                inputMode="decimal"
                placeholder="50000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adv-date">Date</Label>
              <Input
                id="adv-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adv-notes">Notes (optional)</Label>
            <Textarea
              id="adv-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Recording…' : 'Record advance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Vendor debit note                                                           */
/* -------------------------------------------------------------------------- */

export function VendorDebitNoteDialog({
  open,
  onOpenChange,
  vendorId,
  vendorName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
  onDone: () => void;
}) {
  const [subtotal, setSubtotal] = useState('');
  const [gst, setGst] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    const sub = parseRupees(subtotal);
    const g = parseRupees(gst);
    if (sub === null || g === null) {
      toast.error('Enter valid amounts.');
      return;
    }
    if (sub + g <= 0n) {
      toast.error('Enter a positive amount.');
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Give a reason for the debit note.');
      return;
    }
    startTransition(async () => {
      const res = await issueVendorDebitNote({
        vendorId,
        subtotalPaise: sub,
        gstPaise: g,
        reason: reason.trim(),
        txnDate: date,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success('Vendor debit note issued.');
      setSubtotal('');
      setGst('');
      setReason('');
      setNotes('');
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue debit note</DialogTitle>
          <DialogDescription>
            Reduces what you owe {vendorName} (return / over-billing / correction). Posts Dr Payables
            / Cr Vendor cost (+ GST input reversal).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dn-sub">Amount ₹ (excl. GST)</Label>
              <Input
                id="dn-sub"
                inputMode="decimal"
                placeholder="10000"
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dn-gst">GST ₹ (input reversed)</Label>
              <Input
                id="dn-gst"
                inputMode="decimal"
                placeholder="1800"
                value={gst}
                onChange={(e) => setGst(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dn-reason">Reason</Label>
            <Input
              id="dn-reason"
              placeholder="Goods returned — short delivery"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dn-date">Date</Label>
            <Input
              id="dn-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dn-notes">Notes (optional)</Label>
            <Textarea
              id="dn-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Issuing…' : 'Issue debit note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
