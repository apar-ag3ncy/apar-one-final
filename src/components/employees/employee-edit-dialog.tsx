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
import { updateEmployee, type UpdateEmployeeInput } from '@/lib/server/entities/employees';
import { listDepartments } from '@/lib/server-stub/entity-actions';
import { departmentLabel } from '@/components/employees/types';
import type { Employee, EmploymentType } from '@/components/employees/types';

const EMPLOYMENT_TYPES: readonly EmploymentType[] = [
  'full_time',
  'part_time',
  'contractor',
  'intern',
];

const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractor: 'Contractor',
  intern: 'Intern',
};

// UI employment type → DB enum. The UI collapses contract/consultant into
// "contractor"; map it back to the closest DB value on save.
const UI_TO_DB_EMPLOYMENT: Record<EmploymentType, UpdateEmployeeInput['employmentType']> = {
  full_time: 'full_time',
  part_time: 'part_time',
  contractor: 'contract',
  intern: 'intern',
};

const formSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(200),
  designation: z.string().max(160).optional(),
  // Free-text: pick an existing department or type a new one.
  department: z.string().max(120).optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contractor', 'intern']),
  workEmail: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

function toDefaults(employee: Employee): FormValues {
  return {
    fullName: employee.fullName,
    designation: employee.designation ?? '',
    department: employee.department ? departmentLabel(employee.department) : '',
    employmentType: employee.employmentType,
    workEmail: employee.workEmail ?? '',
    phone: employee.phone ?? '',
    notes: employee.notes ?? '',
  };
}

/**
 * Dashboard "Edit" control for an employee profile. Renders its own trigger
 * button (so it drops into the ProfileHeader actions) and a dialog form that
 * patches the parent `employees` row via the `updateEmployee` server action.
 *
 * Only fields the user actually changed are sent — `updateEmployee` treats
 * `undefined` as "leave untouched", so an unedited consultant isn't silently
 * rewritten to `contract` by the UI's lossy employment-type collapse.
 */
export function EmployeeEditDialog({ employee }: { employee: Employee }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [departments, setDepartments] = useState<readonly string[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toDefaults(employee),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(employee));
  }, [open, employee, form]);

  // Load the dynamic department suggestions when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    listDepartments()
      .then((rows) => {
        if (active) setDepartments(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      // Build a patch of only the changed fields.
      const patch: UpdateEmployeeInput = { id: employee.id };
      if (values.fullName !== employee.fullName) patch.fullName = values.fullName;
      if ((values.designation ?? '') !== (employee.designation ?? '')) {
        patch.designation = values.designation ? values.designation : null;
      }
      // Compare case-insensitively (display is title-cased, storage is
      // lowercase). Send the normalized value; the server lowercases too.
      const deptNorm = (values.department ?? '').trim().toLowerCase();
      if (deptNorm !== (employee.department ?? '').trim().toLowerCase()) {
        patch.department = deptNorm || null;
      }
      if (values.employmentType !== employee.employmentType) {
        patch.employmentType = UI_TO_DB_EMPLOYMENT[values.employmentType];
      }
      if ((values.workEmail ?? '') !== (employee.workEmail ?? '')) {
        patch.workEmail = values.workEmail ? values.workEmail : null;
      }
      if ((values.phone ?? '') !== (employee.phone ?? '')) {
        patch.phone = values.phone ? values.phone : null;
      }
      if ((values.notes ?? '') !== (employee.notes ?? '')) {
        patch.notes = values.notes ? values.notes : null;
      }

      // Nothing changed — close without a round-trip.
      if (Object.keys(patch).length === 1) {
        setOpen(false);
        return;
      }

      const result = await updateEmployee(patch);
      if (!result.ok) {
        const fieldKeys = ['fullName', 'workEmail', 'phone', 'designation'] as const;
        let attached = false;
        for (const key of fieldKeys) {
          if (result.errors[key]) {
            form.setError(key, { type: 'server', message: result.errors[key] });
            attached = true;
          }
        }
        if (!attached) toast.error(result.message);
        return;
      }

      toast.success(`Updated ${values.fullName}.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the employee.');
    } finally {
      setSubmitting(false);
    }
  });

  const employmentType = form.watch('employmentType');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {employee.fullName}</DialogTitle>
          <DialogDescription>
            Update the core profile. KYC, banking, salary, and documents are edited from their own
            tabs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="employee-name">Full name</Label>
            <Input
              id="employee-name"
              autoFocus
              {...form.register('fullName')}
              aria-invalid={form.formState.errors.fullName ? true : undefined}
            />
            {form.formState.errors.fullName ? (
              <p className="text-destructive text-xs">{form.formState.errors.fullName.message}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="employee-designation">Designation</Label>
              <Input
                id="employee-designation"
                placeholder="Senior Strategist"
                {...form.register('designation')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="employee-department">Department</Label>
              <Input
                id="employee-department"
                list="employee-department-options"
                placeholder="Pick or type a department"
                {...form.register('department')}
              />
              <datalist id="employee-department-options">
                {departments.map((d) => (
                  <option key={d} value={departmentLabel(d)} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="employee-type">Employment type</Label>
              <Select
                value={employmentType}
                onValueChange={(v) => form.setValue('employmentType', v as EmploymentType)}
              >
                <SelectTrigger id="employee-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {EMPLOYMENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="employee-phone">Phone</Label>
              <Input
                id="employee-phone"
                placeholder="+91 98xxx xxxxx"
                {...form.register('phone')}
              />
              {form.formState.errors.phone ? (
                <p className="text-destructive text-xs">{form.formState.errors.phone.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="employee-email">Work email</Label>
            <Input
              id="employee-email"
              type="email"
              placeholder="name@apar.example"
              {...form.register('workEmail')}
              aria-invalid={form.formState.errors.workEmail ? true : undefined}
            />
            {form.formState.errors.workEmail ? (
              <p className="text-destructive text-xs">{form.formState.errors.workEmail.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="employee-notes">Notes</Label>
            <Textarea
              id="employee-notes"
              rows={3}
              placeholder="Anything the team should know."
              {...form.register('notes')}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
