'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencyInput } from '@/components/shared/currency-input';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { recordBonusOrPerk } from '@/lib/server/entities/payroll';

export function BonusForm({
  employees,
}: {
  employees: readonly { id: string; fullName: string }[];
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [kind, setKind] = useState<'quarterly' | 'festival' | 'retention' | 'spot' | ''>('');
  const [amountPaise, setAmountPaise] = useState<bigint | null>(null);
  const [grantedOn, setGrantedOn] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [paymentTiming, setPaymentTiming] = useState<'with_salary' | 'separate' | ''>('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const canSubmit =
    employeeId && kind && amountPaise && grantedOn && reason.trim() && paymentTiming;

  async function submit() {
    if (!canSubmit || amountPaise === null || busy) return;
    setBusy(true);
    try {
      await recordBonusOrPerk({
        employeeId,
        kind: 'bonus',
        bonusDate: grantedOn,
        amountPaise,
        description: `${kind} bonus (${paymentTiming === 'with_salary' ? 'with salary' : 'separate'}): ${reason.trim()}`,
        taxable: 'captured',
      });
      toast.success('Bonus recorded.');
      setEmployeeId('');
      setKind('');
      setAmountPaise(null);
      setReason('');
      setPaymentTiming('');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the bonus.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Record bonus / perk</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Employee">
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Kind">
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger>
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quarterly">Quarterly performance bonus</SelectItem>
              <SelectItem value="festival">Festival bonus / Diwali</SelectItem>
              <SelectItem value="retention">Retention bonus</SelectItem>
              <SelectItem value="spot">Spot award</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Amount">
          <CurrencyInput value={amountPaise} onValueChange={setAmountPaise} />
        </Field>
        <Field label="Granted on">
          <Input type="date" value={grantedOn} onChange={(e) => setGrantedOn(e.target.value)} />
        </Field>
        <Field label="Payment timing">
          <Select
            value={paymentTiming}
            onValueChange={(v) => setPaymentTiming(v as typeof paymentTiming)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="with_salary">Add to next salary run</SelectItem>
              <SelectItem value="separate">Pay separately</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Reason / citation">
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Visible to the employee in their payslip / portal."
          />
        </Field>
        <div className="flex justify-end">
          <Button disabled={!canSubmit || busy} onClick={submit}>
            {busy ? 'Recording…' : 'Record bonus'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs tracking-wide uppercase">{label}</Label>
      {children}
    </div>
  );
}
