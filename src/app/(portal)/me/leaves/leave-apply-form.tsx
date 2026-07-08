'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DateField } from '@/components/shared/date-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function LeaveApplyForm() {
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // TODO(backend): A.applyLeave({ kind, from, to, reason })
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <p className="text-muted-foreground py-4 text-center text-sm">
        Submitted. Your manager will be notified — you&apos;ll see the status under History.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">Leave kind</Label>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="casual">Casual</SelectItem>
            <SelectItem value="earned">Earned</SelectItem>
            <SelectItem value="sick">Sick</SelectItem>
            <SelectItem value="bereavement">Bereavement</SelectItem>
            <SelectItem value="lop">Loss of pay</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-muted-foreground text-xs tracking-wide uppercase">From</Label>
          <DateField value={from} onChange={setFrom} clearable={false} />
        </div>
        <div>
          <Label className="text-muted-foreground text-xs tracking-wide uppercase">To</Label>
          <DateField value={to} onChange={setTo} clearable={false} />
        </div>
      </div>
      <div>
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">Reason</Label>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!kind || !from || !to}>
          Apply
        </Button>
      </div>
    </form>
  );
}
