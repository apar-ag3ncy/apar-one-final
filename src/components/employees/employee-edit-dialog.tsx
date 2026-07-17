'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  DESIGNATION_SUGGESTIONS,
  addMonthsDays,
  probationDaysLeft,
  splitMonthsDays,
} from '@/lib/employee-badges';
import {
  allowedGradesFor,
  departmentLabel,
  expectedGradeKindFor,
} from '@/components/employees/types';
import type { Employee, EmploymentType, PayrollGrade } from '@/components/employees/types';

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

// Radix Select items can't carry an empty-string value — 'none' is the
// "no grade" sentinel, mapped to NULL on save.
const NO_GRADE = 'none';

const formSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(200),
  designation: z.string().max(160).optional(),
  // Free-text: pick an existing department or type a new one.
  department: z.string().max(120).optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contractor', 'intern']),
  // Salary grade level ('EA+', …) or the 'none' sentinel.
  payrollGrade: z.string().optional(),
  workEmail: z.string().max(200).optional(),
  personalEmail: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  noticePeriodDays: z.string().max(40).optional(),
  // Custom probation period (0081) — months/days from the joining date.
  onProbation: z.boolean(),
  probationMonths: z.string().max(4).optional(),
  probationDays: z.string().max(4).optional(),
  notes: z.string().max(2000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

function toDefaults(employee: Employee): FormValues {
  // Round-trip a stored probation end date back into the months/days inputs.
  const prob = employee.probationEndsOn
    ? splitMonthsDays(employee.joinedAt, employee.probationEndsOn)
    : null;
  return {
    fullName: employee.fullName,
    designation: employee.designation ?? '',
    department: employee.department ? departmentLabel(employee.department) : '',
    employmentType: employee.employmentType,
    payrollGrade: employee.payrollGrade ?? NO_GRADE,
    workEmail: employee.workEmail ?? '',
    personalEmail: employee.personalEmail ?? '',
    phone: employee.phone ?? '',
    noticePeriodDays: employee.noticePeriodDays ?? '',
    onProbation: !!employee.probationEndsOn,
    probationMonths: prob && prob.months ? String(prob.months) : '',
    probationDays: prob && prob.days ? String(prob.days) : '',
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
    const probMonths = Math.max(0, Number.parseInt(values.probationMonths || '0', 10) || 0);
    const probDays = Math.max(0, Number.parseInt(values.probationDays || '0', 10) || 0);
    if (values.onProbation && probMonths === 0 && probDays === 0) {
      toast.error('Enter the probation length in months and/or days.');
      return;
    }
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
      // 'none' sentinel → NULL (clears the grade); unchanged → omitted.
      const nextGrade =
        !values.payrollGrade || values.payrollGrade === NO_GRADE
          ? null
          : (values.payrollGrade as PayrollGrade);
      if (nextGrade !== (employee.payrollGrade ?? null)) {
        patch.payrollGrade = nextGrade;
      }
      if ((values.workEmail ?? '') !== (employee.workEmail ?? '')) {
        patch.workEmail = values.workEmail ? values.workEmail : null;
      }
      if ((values.personalEmail ?? '') !== (employee.personalEmail ?? '')) {
        patch.personalEmail = values.personalEmail ? values.personalEmail : null;
      }
      if ((values.phone ?? '') !== (employee.phone ?? '')) {
        patch.phone = values.phone ? values.phone : null;
      }
      if ((values.noticePeriodDays ?? '') !== (employee.noticePeriodDays ?? '')) {
        patch.noticePeriodDays = values.noticePeriodDays ? values.noticePeriodDays : null;
      }
      // Custom probation end = joined_on + months + days; off → cleared to NULL.
      const nextProbationEndsOn =
        values.onProbation && (probMonths > 0 || probDays > 0)
          ? addMonthsDays(employee.joinedAt, probMonths, probDays)
          : null;
      if (nextProbationEndsOn !== (employee.probationEndsOn ?? null)) {
        patch.probationEndsOn = nextProbationEndsOn;
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
        const fieldKeys = [
          'fullName',
          'workEmail',
          'personalEmail',
          'phone',
          'designation',
          'noticePeriodDays',
        ] as const;
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
  // `||` (not `??`): an empty string must also collapse to the sentinel — a
  // ''-valued Radix SelectItem throws and takes the whole page down.
  const payrollGrade = form.watch('payrollGrade') || NO_GRADE;
  const onProbation = form.watch('onProbation');

  // Category → grade-group coupling (mirrors the OS editor): Intern (type) → I;
  // on probation → PA–PA+; otherwise → EA–EA+. Changing the category re-scopes
  // the grade — interns get I automatically, a wrong-group grade is cleared.
  //
  // The grade assignment is DEFERRED one tick (setTimeout 0), never set in the
  // same tick as the category: setting it synchronously renders the Radix
  // Select with a value whose item isn't mounted yet (the old group's items
  // are), and Radix then fires onValueChange('') — clobbering the assignment.
  // After the deferral React has committed the new group's items, so the value
  // resolves cleanly. Only user-driven category changes coerce; loading an
  // employee never rewrites their stored grade.
  const allowedGrades = allowedGradesFor(employmentType, onProbation);
  const coerceGradeDeferred = (nextType: EmploymentType, nextProbation: boolean) => {
    setTimeout(() => {
      const current = form.getValues('payrollGrade') || NO_GRADE;
      if (nextType === 'intern') {
        if (current !== 'I') form.setValue('payrollGrade', 'I');
        return;
      }
      const allowed = allowedGradesFor(nextType, nextProbation);
      if (current !== NO_GRADE && !allowed.includes(current as PayrollGrade)) {
        form.setValue('payrollGrade', NO_GRADE);
      }
    }, 0);
  };

  // Live preview of the probation end date + days-left as the duration is typed.
  const previewMonths = Math.max(
    0,
    Number.parseInt(form.watch('probationMonths') || '0', 10) || 0,
  );
  const previewDays = Math.max(0, Number.parseInt(form.watch('probationDays') || '0', 10) || 0);
  const probationPreviewDate =
    onProbation && (previewMonths > 0 || previewDays > 0)
      ? addMonthsDays(employee.joinedAt, previewMonths, previewDays)
      : null;
  const probationPreviewLeft = probationPreviewDate
    ? probationDaysLeft({
        joinedOn: employee.joinedAt,
        employmentType: employee.employmentType,
        probationEndsOn: probationPreviewDate,
        confirmedOn: employee.confirmedOn ?? null,
      })
    : null;

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
                list="employee-designation-options"
                placeholder="Senior Strategist"
                {...form.register('designation')}
              />
              {/* Free text; leadership roles are suggested so the TL/Manager
                  chips on the Team cards pick them up consistently. */}
              <datalist id="employee-designation-options">
                {DESIGNATION_SUGGESTIONS.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
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
                onValueChange={(v) => {
                  form.setValue('employmentType', v as EmploymentType);
                  coerceGradeDeferred(v as EmploymentType, onProbation);
                }}
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

          <div className="grid grid-cols-2 gap-3">
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
                <p className="text-destructive text-xs">
                  {form.formState.errors.workEmail.message}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="employee-personal-email">Personal email</Label>
              <Input
                id="employee-personal-email"
                type="email"
                placeholder="personal@example.com"
                {...form.register('personalEmail')}
                aria-invalid={form.formState.errors.personalEmail ? true : undefined}
              />
              {form.formState.errors.personalEmail ? (
                <p className="text-destructive text-xs">
                  {form.formState.errors.personalEmail.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="employee-payroll-grade">
                Payroll grade{' '}
                <span className="text-muted-foreground font-normal">
                  ({expectedGradeKindFor(employmentType, onProbation)})
                </span>
              </Label>
              <Select value={payrollGrade} onValueChange={(v) => form.setValue('payrollGrade', v)}>
                <SelectTrigger id="employee-payroll-grade">
                  <SelectValue placeholder="No grade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GRADE}>No grade</SelectItem>
                  {allowedGrades.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                      {grade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Only fixed-value items above — a dynamic-value SelectItem can
                  transiently render with '' and Radix throws on that, killing
                  the page. A stored grade from another group (legacy row) is
                  surfaced as a hint instead; it stays saved until changed. */}
              {payrollGrade !== NO_GRADE &&
              !allowedGrades.includes(payrollGrade as PayrollGrade) ? (
                <p className="text-muted-foreground text-xs">
                  Current grade {payrollGrade} is from another group — pick a replacement above or
                  change the category.
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="employee-notice-period">Notice period</Label>
              <Input
                id="employee-notice-period"
                placeholder="e.g. 30 days"
                {...form.register('noticePeriodDays')}
                aria-invalid={form.formState.errors.noticePeriodDays ? true : undefined}
              />
              {form.formState.errors.noticePeriodDays ? (
                <p className="text-destructive text-xs">
                  {form.formState.errors.noticePeriodDays.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Probation</Label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={onProbation}
                onCheckedChange={(v) => {
                  const checked = v === true;
                  form.setValue('onProbation', checked);
                  coerceGradeDeferred(employmentType, checked);
                }}
                disabled={submitting}
              />
              On probation
            </label>
            {onProbation ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className="w-20"
                  placeholder="0"
                  aria-label="Probation months"
                  {...form.register('probationMonths')}
                />
                <span className="text-muted-foreground text-xs">months</span>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className="w-20"
                  placeholder="0"
                  aria-label="Probation days"
                  {...form.register('probationDays')}
                />
                <span className="text-muted-foreground text-xs">days from joining</span>
                {probationPreviewDate ? (
                  <span className="text-muted-foreground text-xs">
                    → ends{' '}
                    {new Date(probationPreviewDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {probationPreviewLeft != null ? ` (${probationPreviewLeft}d left)` : ''}
                  </span>
                ) : null}
              </div>
            ) : null}
            <p className="text-muted-foreground text-xs">
              Overrides the default 6-month window; a confirmation date ends probation.
            </p>
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
