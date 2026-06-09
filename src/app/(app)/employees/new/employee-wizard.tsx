'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
import { formatINR } from '@/components/shared/format-inr';
import { CreationWizard, type WizardStep } from '@/components/entity/creation-wizard';
import { CustomFieldsStep } from '@/components/entity/creation/custom-fields-step';
import { PriorRecordsStep } from '@/components/entity/creation/prior-records-step';
import { runPostCreate, type CustomFieldEntry } from '@/components/entity/creation/run-post-create';
import type { DocumentDraft } from '@/components/entity/creation/types';
import type { FormTemplate, FormValues } from '@/components/entity/form-template-types';
import { createEmployee } from '@/lib/server/entities/employees';
import { listEmployeeOptions, type EntityOption } from '@/lib/server/entities/options';
import { listDepartments } from '@/lib/server-stub/entity-actions';
import { departmentLabel } from '@/components/employees/types';

type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern' | 'consultant';
type EmployeeStatus = 'prospective' | 'active' | 'on_leave' | 'notice' | 'separated';

type ContractDraft =
  | { kind: 'signed'; file: File | null; fileName: string; signedAt: string }
  | { kind: 'pending'; reason: string; expectedBy: string }
  | { kind: 'waived'; reason: string };

type EmployeeValues = {
  // Identity
  fullName: string;
  displayName: string;
  employeeCode: string;
  workEmail: string;
  personalEmail: string;
  phone: string;
  // Employment
  employmentType: EmploymentType | '';
  status: EmployeeStatus;
  designation: string;
  department: string;
  reportsToEmployeeId: string;
  joinedOn: string;
  confirmedOn: string;
  noticePeriodDays: string;
  // KYC & address
  pan: string;
  aadhaar: string;
  registeredAddress: string;
  // Compensation
  salary: {
    basicPaise: bigint | null;
    hraPaise: bigint | null;
    specialAllowancePaise: bigint | null;
    ctcMonthlyPaise: bigint | null;
    effectiveFrom: string;
  };
  bank: { bankName: string; accountNumber: string; ifsc: string; holderName: string };
  // Contract & documents
  contract: ContractDraft;
  documents: DocumentDraft[];
  // Custom fields
  customValues: FormValues;
};

const INITIAL: EmployeeValues = {
  fullName: '',
  displayName: '',
  employeeCode: '',
  workEmail: '',
  personalEmail: '',
  phone: '',
  employmentType: '',
  status: 'active',
  designation: '',
  department: '',
  reportsToEmployeeId: '',
  joinedOn: '',
  confirmedOn: '',
  noticePeriodDays: '',
  pan: '',
  aadhaar: '',
  registeredAddress: '',
  salary: {
    basicPaise: null,
    hraPaise: null,
    specialAllowancePaise: null,
    ctcMonthlyPaise: null,
    effectiveFrom: '',
  },
  bank: { bankName: '', accountNumber: '', ifsc: '', holderName: '' },
  contract: { kind: 'pending', reason: '', expectedBy: '' },
  documents: [],
  customValues: {},
};

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function EmployeeWizard() {
  const router = useRouter();
  // Template captured by the custom-fields step so we can persist values.
  const customTemplateRef = useRef<FormTemplate | null>(null);

  const steps: WizardStep<EmployeeValues>[] = [
    {
      id: 'identity',
      title: 'Identity',
      description: 'Name, code, contact',
      validate: (v) => {
        const e: Record<string, string> = {};
        if (!v.fullName.trim()) e.fullName = 'Full name is required';
        return e;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.fullName} required>
            <Input
              value={values.fullName}
              onChange={(e) => onPatch({ fullName: e.target.value })}
            />
          </Field>
          <Field label="Display name" hint="Optional — shown around the app">
            <Input
              value={values.displayName}
              onChange={(e) => onPatch({ displayName: e.target.value })}
            />
          </Field>
          <Field
            label="Employee code"
            hint="Leave blank to auto-generate (APAR-NNN)"
            error={errors.employeeCode}
          >
            <Input
              className="font-mono uppercase"
              placeholder="APAR-001"
              value={values.employeeCode}
              onChange={(e) => onPatch({ employeeCode: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Phone">
            <Input
              type="tel"
              value={values.phone}
              onChange={(e) => onPatch({ phone: e.target.value })}
            />
          </Field>
          <Field label="Work email">
            <Input
              type="email"
              value={values.workEmail}
              onChange={(e) => onPatch({ workEmail: e.target.value })}
            />
          </Field>
          <Field label="Personal email">
            <Input
              type="email"
              value={values.personalEmail}
              onChange={(e) => onPatch({ personalEmail: e.target.value })}
            />
          </Field>
        </div>
      ),
    },
    {
      id: 'employment',
      title: 'Employment',
      description: 'Role, type, joining date',
      validate: (v) => {
        const e: Record<string, string> = {};
        if (!v.employmentType) e.employmentType = 'Employment type is required';
        if (!v.joinedOn || !ISO.test(v.joinedOn)) e.joinedOn = 'Joining date is required';
        return e;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Employment type" error={errors.employmentType} required>
            <Select
              value={values.employmentType}
              onValueChange={(v) => onPatch({ employmentType: v as EmploymentType })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full-time</SelectItem>
                <SelectItem value="part_time">Part-time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
                <SelectItem value="intern">Intern</SelectItem>
                <SelectItem value="consultant">Consultant</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select
              value={values.status}
              onValueChange={(v) => onPatch({ status: v as EmployeeStatus })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prospective">Prospective</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_leave">On leave</SelectItem>
                <SelectItem value="notice">Notice</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Designation">
            <Input
              value={values.designation}
              onChange={(e) => onPatch({ designation: e.target.value })}
            />
          </Field>
          <Field label="Department">
            <DepartmentField
              value={values.department}
              onChange={(d) => onPatch({ department: d })}
            />
          </Field>
          <Field label="Reports to">
            <ReportsToField
              value={values.reportsToEmployeeId}
              onChange={(id) => onPatch({ reportsToEmployeeId: id })}
            />
          </Field>
          <Field label="Notice period" hint="Free text — e.g. “30 days”">
            <Input
              value={values.noticePeriodDays}
              onChange={(e) => onPatch({ noticePeriodDays: e.target.value })}
            />
          </Field>
          <Field label="Joining date" error={errors.joinedOn} required>
            <Input
              type="date"
              value={values.joinedOn}
              onChange={(e) => onPatch({ joinedOn: e.target.value })}
            />
          </Field>
          <Field label="Confirmation date" hint="Optional">
            <Input
              type="date"
              value={values.confirmedOn}
              onChange={(e) => onPatch({ confirmedOn: e.target.value })}
            />
          </Field>
        </div>
      ),
    },
    {
      id: 'kyc',
      title: 'KYC & address',
      description: 'PAN, Aadhaar, home address',
      validate: (v) => {
        const e: Record<string, string> = {};
        if (v.pan && !PAN_RE.test(v.pan)) e.pan = 'Invalid PAN format';
        if (v.aadhaar && !/^\d{12}$/.test(v.aadhaar.replace(/\s+/g, '')))
          e.aadhaar = 'Aadhaar must be 12 digits';
        return e;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="PAN" error={errors.pan} hint="Stored masked (XXXXX1234X)">
            <Input
              className="font-mono uppercase"
              value={values.pan}
              onChange={(e) => onPatch({ pan: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field
            label="Aadhaar"
            error={errors.aadhaar}
            hint="Stored masked; scan goes to KYC vault"
          >
            <Input
              className="font-mono"
              inputMode="numeric"
              value={values.aadhaar}
              onChange={(e) => onPatch({ aadhaar: e.target.value })}
            />
          </Field>
          <Field label="Home address" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={values.registeredAddress}
              onChange={(e) => onPatch({ registeredAddress: e.target.value })}
            />
          </Field>
        </div>
      ),
    },
    {
      id: 'compensation',
      title: 'Compensation',
      description: 'Salary structure (captured) + bank',
      render: ({ values, onPatch }) => (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Basic (monthly)">
              <CurrencyInput
                value={values.salary.basicPaise}
                onValueChange={(p) => onPatch({ salary: { ...values.salary, basicPaise: p } })}
              />
            </Field>
            <Field label="HRA (monthly)">
              <CurrencyInput
                value={values.salary.hraPaise}
                onValueChange={(p) => onPatch({ salary: { ...values.salary, hraPaise: p } })}
              />
            </Field>
            <Field label="Special allowance (monthly)">
              <CurrencyInput
                value={values.salary.specialAllowancePaise}
                onValueChange={(p) =>
                  onPatch({ salary: { ...values.salary, specialAllowancePaise: p } })
                }
              />
            </Field>
            <Field label="CTC (monthly)" hint="As captured from the offer letter — not computed">
              <CurrencyInput
                value={values.salary.ctcMonthlyPaise}
                onValueChange={(p) => onPatch({ salary: { ...values.salary, ctcMonthlyPaise: p } })}
              />
            </Field>
            <Field label="Effective from" hint="Defaults to the joining date">
              <Input
                type="date"
                value={values.salary.effectiveFrom}
                onChange={(e) =>
                  onPatch({ salary: { ...values.salary, effectiveFrom: e.target.value } })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-2">
            <Field label="Salary account — bank">
              <Input
                value={values.bank.bankName}
                onChange={(e) => onPatch({ bank: { ...values.bank, bankName: e.target.value } })}
              />
            </Field>
            <Field label="Account number" hint="Stored as last-4 only">
              <Input
                className="font-mono"
                value={values.bank.accountNumber}
                onChange={(e) =>
                  onPatch({ bank: { ...values.bank, accountNumber: e.target.value } })
                }
              />
            </Field>
            <Field label="IFSC">
              <Input
                className="font-mono uppercase"
                value={values.bank.ifsc}
                onChange={(e) =>
                  onPatch({ bank: { ...values.bank, ifsc: e.target.value.toUpperCase() } })
                }
              />
            </Field>
            <Field label="Account holder">
              <Input
                value={values.bank.holderName}
                onChange={(e) => onPatch({ bank: { ...values.bank, holderName: e.target.value } })}
              />
            </Field>
          </div>
        </div>
      ),
    },
    {
      id: 'contract',
      title: 'Contract & documents',
      description: 'Offer letter + prior records',
      validate: (v) => {
        const e: Record<string, string> = {};
        if (v.contract.kind === 'pending') {
          if (!v.contract.reason.trim()) e['contract.reason'] = 'Reason required when pending';
          if (!v.contract.expectedBy) e['contract.expectedBy'] = 'ETA date required';
        } else if (v.contract.kind === 'signed') {
          if (!v.contract.signedAt) e['contract.signedAt'] = 'Signed date required';
        }
        return e;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Offer / contract status">
              <Select
                value={values.contract.kind}
                onValueChange={(v) =>
                  onPatch({
                    contract:
                      v === 'signed'
                        ? { kind: 'signed', file: null, fileName: '', signedAt: '' }
                        : v === 'waived'
                          ? { kind: 'waived', reason: '' }
                          : { kind: 'pending', reason: '', expectedBy: '' },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="signed">Signed — uploading now</SelectItem>
                  <SelectItem value="pending">Pending — reason + ETA</SelectItem>
                  <SelectItem value="waived">Waived</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {values.contract.kind === 'signed' ? (
              <>
                <Field label="Signed on" error={errors['contract.signedAt']}>
                  <Input
                    type="date"
                    value={values.contract.signedAt}
                    onChange={(e) =>
                      onPatch({
                        contract: { ...values.contract, signedAt: e.target.value } as ContractDraft,
                      })
                    }
                  />
                </Field>
                <Field label="Offer letter file" className="sm:col-span-2">
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      onPatch({
                        contract: {
                          ...(values.contract as Extract<ContractDraft, { kind: 'signed' }>),
                          file,
                          fileName: file?.name ?? '',
                        },
                      });
                    }}
                  />
                </Field>
              </>
            ) : values.contract.kind === 'pending' ? (
              <>
                <Field label="Pending reason" error={errors['contract.reason']}>
                  <Input
                    value={values.contract.reason}
                    onChange={(e) =>
                      onPatch({
                        contract: { ...values.contract, reason: e.target.value } as ContractDraft,
                      })
                    }
                  />
                </Field>
                <Field label="Expected by" error={errors['contract.expectedBy']}>
                  <Input
                    type="date"
                    value={values.contract.expectedBy}
                    onChange={(e) =>
                      onPatch({
                        contract: {
                          ...values.contract,
                          expectedBy: e.target.value,
                        } as ContractDraft,
                      })
                    }
                  />
                </Field>
              </>
            ) : (
              <Field label="Waiver reason" className="sm:col-span-1">
                <Input
                  value={values.contract.reason}
                  onChange={(e) =>
                    onPatch({
                      contract: { ...values.contract, reason: e.target.value } as ContractDraft,
                    })
                  }
                />
              </Field>
            )}
          </div>
          <div className="border-t pt-5">
            <PriorRecordsStep
              entityType="employee"
              documents={values.documents}
              onChange={(documents) => onPatch({ documents })}
              showAmount={false}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'custom',
      title: 'Custom fields',
      description: 'Org-defined fields',
      render: ({ values, onPatch }) => (
        <CustomFieldsStep
          entityType="employee"
          values={values.customValues}
          onChange={(customValues) => onPatch({ customValues })}
          onTemplateLoaded={(t) => {
            customTemplateRef.current = t;
          }}
        />
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Final check before save',
      render: ({ values }) => <ReviewBlock values={values} />,
    },
  ];

  async function handleSubmit(values: EmployeeValues) {
    if (!values.employmentType) {
      return {
        ok: false as const,
        message: 'Pick an employment type before saving.',
        errors: { employmentType: 'Employment type is required' },
      };
    }

    const contractInput =
      values.contract.kind === 'signed'
        ? {
            kind: 'signed' as const,
            uploadedFileName: values.contract.fileName || 'offer-letter',
            signedAt: values.contract.signedAt,
          }
        : values.contract.kind === 'pending'
          ? {
              kind: 'pending' as const,
              reason: values.contract.reason,
              expectedBy: values.contract.expectedBy,
            }
          : { kind: 'waived' as const, reason: values.contract.reason || undefined };

    const result = await createEmployee({
      fullName: values.fullName,
      displayName: values.displayName || undefined,
      employeeCode: values.employeeCode || undefined,
      workEmail: values.workEmail || undefined,
      personalEmail: values.personalEmail || undefined,
      phone: values.phone || undefined,
      employmentType: values.employmentType,
      status: values.status,
      designation: values.designation || undefined,
      department: values.department || undefined,
      reportsToEmployeeId: values.reportsToEmployeeId || undefined,
      joinedOn: values.joinedOn,
      confirmedOn: values.confirmedOn || undefined,
      noticePeriodDays: values.noticePeriodDays || undefined,
      pan: values.pan || undefined,
      aadhaar: values.aadhaar || undefined,
      registeredAddress: values.registeredAddress || undefined,
      salary: {
        effectiveFrom: values.salary.effectiveFrom || undefined,
        basicPaise: values.salary.basicPaise != null ? Number(values.salary.basicPaise) : undefined,
        hraPaise: values.salary.hraPaise != null ? Number(values.salary.hraPaise) : undefined,
        specialAllowancePaise:
          values.salary.specialAllowancePaise != null
            ? Number(values.salary.specialAllowancePaise)
            : undefined,
        ctcMonthlyPaise:
          values.salary.ctcMonthlyPaise != null ? Number(values.salary.ctcMonthlyPaise) : undefined,
      },
      bank: {
        bankName: values.bank.bankName || undefined,
        accountNumber: values.bank.accountNumber || undefined,
        ifsc: values.bank.ifsc || undefined,
        holderName: values.bank.holderName || undefined,
      },
      contract: contractInput,
    });

    if (!result.ok) return result;

    // Post-create: file the offer letter + any prior records + custom values.
    const documents: DocumentDraft[] = [...values.documents];
    if (values.contract.kind === 'signed' && values.contract.file) {
      documents.push({
        uid: 'offer-letter',
        file: values.contract.file,
        kind: 'offer_letter',
        title: 'Offer letter',
        docDate: values.contract.signedAt,
        amount: '',
      });
    }
    const customValues: CustomFieldEntry[] = customTemplateRef.current
      ? customTemplateRef.current.fields
          .filter((f) => values.customValues[f.id] !== undefined)
          .map((f) => ({ formFieldId: f.id, value: values.customValues[f.id] }))
      : [];

    if (documents.some((d) => d.file) || customValues.length > 0) {
      const post = await runPostCreate({
        entityType: 'employee',
        entityId: result.id,
        documents,
        customValues,
      });
      if (post.failures.length > 0) {
        toast.warning(`Employee created, but ${post.failures.length} attachment(s) failed.`, {
          description: `${post.failures.slice(0, 3).join('; ')} — re-add these from the employee's Documents tab.`,
          duration: 10000,
        });
      } else if (post.uploaded > 0 || post.customSaved > 0) {
        toast.success(`Filed ${post.uploaded} document(s).`);
      }
    }

    router.push(`/employees/${result.id}`);
    return result;
  }

  return (
    <CreationWizard<EmployeeValues>
      title="Add an employee"
      steps={steps}
      initialValues={INITIAL}
      onSubmit={handleSubmit}
      onCancel={() => router.push('/employees')}
    />
  );
}

function ReportsToField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [options, setOptions] = useState<readonly EntityOption[]>([]);
  useEffect(() => {
    let active = true;
    listEmployeeOptions()
      .then((o) => {
        if (active) setOptions(o);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const NONE = '__none__';
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
      <SelectTrigger>
        <SelectValue placeholder="No manager" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No manager</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
            {o.sub ? ` · ${o.sub}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DepartmentField({
  value,
  onChange,
}: {
  value: string;
  onChange: (department: string) => void;
}) {
  const [departments, setDepartments] = useState<readonly string[]>([]);
  useEffect(() => {
    let active = true;
    listDepartments()
      .then((d) => {
        if (active) setDepartments(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Input
        list="wizard-department-options"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Pick or type a department"
      />
      <datalist id="wizard-department-options">
        {departments.map((d) => (
          <option key={d} value={departmentLabel(d)} />
        ))}
      </datalist>
    </>
  );
}

function ReviewBlock({ values }: { values: EmployeeValues }) {
  const docCount = values.documents.filter((d) => d.file).length;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Row label="Full name" value={values.fullName || '—'} />
        <Row label="Employee code" value={values.employeeCode || 'Auto (APAR-NNN)'} />
        <Row
          label="Employment"
          value={`${values.employmentType || '—'}${values.designation ? ` · ${values.designation}` : ''}`}
        />
        <Row label="Department" value={values.department || '—'} />
        <Row label="Joining date" value={values.joinedOn || '—'} />
        <Row label="PAN" value={values.pan || '—'} />
        <Row label="Contract" value={values.contract.kind} />
        <Row
          label="CTC (monthly)"
          value={
            values.salary.ctcMonthlyPaise != null ? formatINR(values.salary.ctcMonthlyPaise) : '—'
          }
        />
      </dl>
      <p className="text-muted-foreground text-xs">
        {docCount > 0
          ? `${docCount} document(s) will be filed after creation.`
          : 'No documents attached.'}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
        {required ? <span className="text-destructive ml-1">*</span> : null}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </div>
  );
}
