'use client';

import { useState } from 'react';
import { UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/shared/currency-input';

export function ReimbursementSubmitForm() {
  const [amount, setAmount] = useState<bigint | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState('');
  const [receiptName, setReceiptName] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p className="text-muted-foreground py-4 text-center text-sm">
        Submitted. Your manager will review it — track status under History.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
      className="space-y-3"
    >
      <div>
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">Summary</Label>
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="e.g. Client site visit · cab + meals"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-muted-foreground text-xs tracking-wide uppercase">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label className="text-muted-foreground text-xs tracking-wide uppercase">Amount</Label>
          <CurrencyInput value={amount} onValueChange={setAmount} />
        </div>
      </div>
      <div>
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">Receipt</Label>
        {receiptName ? (
          <div className="flex items-center justify-between rounded-md border p-2 text-sm">
            <span className="font-mono">{receiptName}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setReceiptName('')}>
              Replace
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setReceiptName('receipt-' + Date.now() + '.jpg')}
          >
            <UploadIcon className="mr-1.5 size-3.5" aria-hidden />
            Upload receipt
          </Button>
        )}
      </div>
      <div>
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">
          Notes (optional)
        </Label>
        <Textarea rows={2} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!summary || !amount || !receiptName}>
          Submit reimbursement
        </Button>
      </div>
    </form>
  );
}
