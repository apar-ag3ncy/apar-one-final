'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createProject } from '@/lib/server/entities/projects';
import { PROJECT_DB_STATUS_LABELS, type ProjectDbStatus } from '@/components/projects/types';

const NONE_VALUE = '__none__';

const formSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(200),
  code: z.string().max(60).optional(),
  status: z.enum(['pitch', 'won', 'active', 'on_hold', 'completed', 'cancelled']),
  leadEmployeeId: z.string().optional(),
  accountManagerId: z.string().optional(),
  feeRupees: z.string().optional(),
  startedOn: z.string().optional(),
  targetEndOn: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

const STATUS_ORDER: readonly ProjectDbStatus[] = [
  'pitch',
  'won',
  'active',
  'on_hold',
  'completed',
  'cancelled',
];

export type EmployeeOption = { id: string; name: string };
export type UserOption = { id: string; name: string };

export function NewProjectDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  employees,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  employees: readonly EmployeeOption[];
  users: readonly UserOption[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      code: '',
      status: 'pitch',
      leadEmployeeId: NONE_VALUE,
      accountManagerId: NONE_VALUE,
      feeRupees: '',
      startedOn: '',
      targetEndOn: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: '',
        code: '',
        status: 'pitch',
        leadEmployeeId: NONE_VALUE,
        accountManagerId: NONE_VALUE,
        feeRupees: '',
        startedOn: '',
        targetEndOn: '',
        notes: '',
      });
    }
  }, [open, form]);

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const feePaise = parseFeeRupeesToPaise(values.feeRupees);
      const { id } = await createProject({
        clientId,
        name: values.name,
        code: values.code ? values.code : null,
        status: values.status,
        leadEmployeeId:
          values.leadEmployeeId && values.leadEmployeeId !== NONE_VALUE
            ? values.leadEmployeeId
            : null,
        accountManagerId:
          values.accountManagerId && values.accountManagerId !== NONE_VALUE
            ? values.accountManagerId
            : null,
        feePaise,
        startedOn: values.startedOn ? values.startedOn : null,
        targetEndOn: values.targetEndOn ? values.targetEndOn : null,
        notes: values.notes ? values.notes : null,
      });
      toast.success(`Project created · ${values.name}`);
      onOpenChange(false);
      router.refresh();
      // Optional deep-link — keep on client page for now; user can click through.
      void id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create project.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  });

  const status = form.watch('status');
  const leadEmployeeId = form.watch('leadEmployeeId') ?? NONE_VALUE;
  const accountManagerId = form.watch('accountManagerId') ?? NONE_VALUE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New project for {clientName}</DialogTitle>
          <DialogDescription>
            Capture the engagement details. Fee is in ₹ — saved as paise.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              autoFocus
              placeholder="Marigold spring launch"
              {...form.register('name')}
              aria-invalid={form.formState.errors.name ? true : undefined}
            />
            {form.formState.errors.name ? (
              <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="project-code">Code</Label>
              <Input id="project-code" placeholder="APR-FY26-007" {...form.register('code')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="project-status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => form.setValue('status', v as ProjectDbStatus)}
              >
                <SelectTrigger id="project-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PROJECT_DB_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="project-lead">Lead (employee)</Label>
              <Select
                value={leadEmployeeId}
                onValueChange={(v) => form.setValue('leadEmployeeId', v)}
              >
                <SelectTrigger id="project-lead">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>—</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="project-poc">POC (account manager)</Label>
              <Select
                value={accountManagerId}
                onValueChange={(v) => form.setValue('accountManagerId', v)}
              >
                <SelectTrigger id="project-poc">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>—</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="project-fee">Fee (₹)</Label>
              <Input
                id="project-fee"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="1250000"
                {...form.register('feeRupees')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="project-start">Start date</Label>
              <Input id="project-start" type="date" {...form.register('startedOn')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="project-end">Target end</Label>
              <Input id="project-end" type="date" {...form.register('targetEndOn')} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="project-notes">Notes</Label>
            <Textarea
              id="project-notes"
              rows={3}
              placeholder="Scope outline, decisions, anything the team should know."
              {...form.register('notes')}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function parseFeeRupeesToPaise(input: string | undefined): bigint {
  if (!input) return 0n;
  const trimmed = input.trim();
  if (trimmed === '') return 0n;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return 0n;
  // Round to two decimals to avoid binary-float drift before scaling to paise.
  return BigInt(Math.round(n * 100));
}
