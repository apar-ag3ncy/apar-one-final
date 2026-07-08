'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { DateField } from '@/components/shared/date-field';
import { CreationWizard, type WizardStep } from '@/components/entity/creation-wizard';
import { CustomFieldsStep } from '@/components/entity/creation/custom-fields-step';
import { PriorRecordsStep } from '@/components/entity/creation/prior-records-step';
import { runPostCreate, type CustomFieldEntry } from '@/components/entity/creation/run-post-create';
import type { DocumentDraft } from '@/components/entity/creation/types';
import type { FormTemplate, FormValues } from '@/components/entity/form-template-types';
import { createVendor } from '@/lib/server/entities/vendors';

type ContactDraft = {
  name: string;
  email: string;
  phone: string;
  title: string;
  isPrimary: boolean;
};

type BankDraft = {
  bankName: string;
  accountNumber: string;
  ifsc: string;
  holderName: string;
};

type ContractDraft =
  | { kind: 'signed'; file: File | null; uploadedFileName: string; signedAt: string }
  | { kind: 'pending'; reason: string; expectedBy: string };

const VENDOR_CATEGORIES: readonly string[] = [
  'Photographer',
  'Printer',
  'Production',
  'Software',
  'Illustration',
  'Logistics',
  'Talent',
  'Animation',
  'Localisation',
  'Freelancer',
  'Other',
];

type VendorValues = {
  // Step 1 — Identity
  name: string;
  category: string;
  primaryEmail: string;
  primaryPhone: string;
  // Step 2 — Tax & legal
  pan: string;
  gstin: string;
  msme: string;
  registeredAddress: string;
  // Step 3 — Commercial
  paymentTermsDays: string;
  // Step 4 — Contacts
  contacts: ContactDraft[];
  // Step 5 — Banking
  bank: BankDraft;
  // Step 6 — Contract
  contract: ContractDraft;
  // Step 7 — Prior records & documents (uploaded post-create)
  documents: DocumentDraft[];
  // Step 8 — Custom fields (org-defined via Form Builder)
  customValues: FormValues;
  // Notes
  notes: string;
};

const INITIAL: VendorValues = {
  name: '',
  category: '',
  primaryEmail: '',
  primaryPhone: '',
  pan: '',
  gstin: '',
  msme: '',
  registeredAddress: '',
  paymentTermsDays: '30',
  contacts: [{ name: '', email: '', phone: '', title: '', isPrimary: true }],
  bank: { bankName: '', accountNumber: '', ifsc: '', holderName: '' },
  contract: { kind: 'pending', reason: '', expectedBy: '' },
  documents: [],
  customValues: {},
  notes: '',
};

export function VendorWizard() {
  const router = useRouter();
  // Captured by the custom-fields step so we can map values → form_fields on save.
  const customTemplateRef = useRef<FormTemplate | null>(null);

  const steps: WizardStep<VendorValues>[] = [
    {
      id: 'identity',
      title: 'Identity',
      description: 'Vendor name, category, primary contact',
      validate: (v) => {
        const errors: Record<string, string> = {};
        if (!v.name.trim()) errors.name = 'Vendor name is required';
        if (!v.primaryEmail.trim() && !v.primaryPhone.trim()) {
          errors.primaryEmail = 'At least one of email or phone is required';
        }
        return errors;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Vendor name" error={errors.name} required>
            <Input value={values.name} onChange={(e) => onPatch({ name: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={values.category} onValueChange={(v) => onPatch({ category: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {VENDOR_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Primary email" error={errors.primaryEmail}>
            <Input
              type="email"
              value={values.primaryEmail}
              onChange={(e) => onPatch({ primaryEmail: e.target.value })}
            />
          </Field>
          <Field label="Primary phone" error={errors.primaryPhone}>
            <Input
              type="tel"
              value={values.primaryPhone}
              onChange={(e) => onPatch({ primaryPhone: e.target.value })}
            />
          </Field>
        </div>
      ),
    },
    {
      id: 'tax',
      title: 'Tax & legal',
      description: 'PAN, GSTIN, MSME, registered address',
      validate: (v) => {
        const errors: Record<string, string> = {};
        const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
        const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
        if (v.pan && !PAN.test(v.pan)) errors.pan = 'Invalid PAN format';
        if (v.gstin && !GSTIN.test(v.gstin)) errors.gstin = 'Invalid GSTIN format';
        return errors;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="PAN" error={errors.pan} hint="Format: ABCDE1234F">
            <Input
              className="font-mono uppercase"
              value={values.pan}
              onChange={(e) => onPatch({ pan: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="GSTIN" error={errors.gstin} hint="Format: 27ABCDE1234F1Z5">
            <Input
              className="font-mono uppercase"
              value={values.gstin}
              onChange={(e) => onPatch({ gstin: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="MSME / Udyam">
            <Input
              className="font-mono"
              value={values.msme}
              onChange={(e) => onPatch({ msme: e.target.value })}
            />
          </Field>
          <Field label="Registered address" className="sm:col-span-2">
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
      id: 'commercial',
      title: 'Commercial terms',
      description: 'Net payment days',
      validate: (v) => {
        const errors: Record<string, string> = {};
        if (v.paymentTermsDays.trim() !== '') {
          const n = Number.parseInt(v.paymentTermsDays, 10);
          if (!Number.isFinite(n) || n < 0 || n > 365) {
            errors.paymentTermsDays = 'Net days must be 0–365.';
          }
        }
        return errors;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Net payment terms (days)"
            error={errors.paymentTermsDays}
            hint="Captured from the agreement — never computed."
          >
            <Input
              type="number"
              min={0}
              max={365}
              value={values.paymentTermsDays}
              onChange={(e) => onPatch({ paymentTermsDays: e.target.value })}
            />
          </Field>
        </div>
      ),
    },
    {
      id: 'contacts',
      title: 'Contacts',
      description: 'Optional — auto-fills from the primary email/phone if blank',
      validate: (v) => {
        const errors: Record<string, string> = {};
        v.contacts.forEach((c, idx) => {
          const hasAny = c.name.trim() || c.email.trim() || c.phone.trim() || c.title.trim();
          if (!hasAny) return;
          if (!c.name.trim()) errors[`contacts.${idx}.name`] = 'Name required';
          if (!c.email.trim() && !c.phone.trim()) {
            errors[`contacts.${idx}.email`] = 'Email or phone required';
          }
        });
        return errors;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="space-y-4">
          {values.contacts.map((contact, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
              <Field label="Name" error={errors[`contacts.${idx}.name`]}>
                <Input
                  value={contact.name}
                  onChange={(e) => {
                    const next = values.contacts.slice();
                    next[idx] = { ...contact, name: e.target.value };
                    onPatch({ contacts: next });
                  }}
                />
              </Field>
              <Field label="Title">
                <Input
                  value={contact.title}
                  onChange={(e) => {
                    const next = values.contacts.slice();
                    next[idx] = { ...contact, title: e.target.value };
                    onPatch({ contacts: next });
                  }}
                />
              </Field>
              <Field label="Email" error={errors[`contacts.${idx}.email`]}>
                <Input
                  type="email"
                  value={contact.email}
                  onChange={(e) => {
                    const next = values.contacts.slice();
                    next[idx] = { ...contact, email: e.target.value };
                    onPatch({ contacts: next });
                  }}
                />
              </Field>
              <Field label="Phone">
                <Input
                  type="tel"
                  value={contact.phone}
                  onChange={(e) => {
                    const next = values.contacts.slice();
                    next[idx] = { ...contact, phone: e.target.value };
                    onPatch({ contacts: next });
                  }}
                />
              </Field>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onPatch({
                contacts: [
                  ...values.contacts,
                  { name: '', email: '', phone: '', title: '', isPrimary: false },
                ],
              })
            }
          >
            Add another contact
          </Button>
        </div>
      ),
    },
    {
      id: 'banking',
      title: 'Banking',
      description: 'Optional — full account number stored encrypted, only last-4 shown later',
      render: ({ values, onPatch }) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bank name">
            <Input
              value={values.bank.bankName}
              onChange={(e) => onPatch({ bank: { ...values.bank, bankName: e.target.value } })}
            />
          </Field>
          <Field
            label="Account number"
            hint="Encrypted on save; only the last four digits are displayed afterwards"
          >
            <Input
              className="font-mono"
              value={values.bank.accountNumber}
              onChange={(e) => onPatch({ bank: { ...values.bank, accountNumber: e.target.value } })}
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
      ),
    },
    {
      id: 'contract',
      title: 'Contract',
      description: 'Server enforces — pending requires reason + ETA within 30 days',
      validate: (v) => {
        const errors: Record<string, string> = {};
        if (v.contract.kind === 'pending') {
          if (!v.contract.reason.trim()) errors['contract.reason'] = 'Reason required when pending';
          if (!v.contract.expectedBy) errors['contract.expectedBy'] = 'ETA date required';
        } else if (v.contract.kind === 'signed') {
          if (!v.contract.uploadedFileName)
            errors['contract.uploadedFileName'] = 'Upload the signed contract';
          if (!v.contract.signedAt) errors['contract.signedAt'] = 'Signed date required';
        }
        return errors;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="space-y-4">
          <Field label="Contract status">
            <Select
              value={values.contract.kind}
              onValueChange={(v) =>
                onPatch({
                  contract:
                    v === 'signed'
                      ? { kind: 'signed', file: null, uploadedFileName: '', signedAt: '' }
                      : { kind: 'pending', reason: '', expectedBy: '' },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="signed">Signed — uploading now</SelectItem>
                <SelectItem value="pending">Pending — capture reason + ETA</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {values.contract.kind === 'signed' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Signed file" error={errors['contract.uploadedFileName']}>
                <Input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    onPatch({
                      contract: {
                        ...values.contract,
                        file,
                        uploadedFileName: file?.name ?? '',
                      } as ContractDraft,
                    });
                  }}
                />
              </Field>
              <Field label="Signed on" error={errors['contract.signedAt']}>
                <DateField
                  value={(values.contract as Extract<ContractDraft, { kind: 'signed' }>).signedAt}
                  onChange={(next) =>
                    onPatch({
                      contract: {
                        ...(values.contract as Extract<ContractDraft, { kind: 'signed' }>),
                        signedAt: next,
                      },
                    })
                  }
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Pending reason" error={errors['contract.reason']}>
                <Input
                  value={(values.contract as Extract<ContractDraft, { kind: 'pending' }>).reason}
                  onChange={(e) =>
                    onPatch({
                      contract: {
                        ...(values.contract as Extract<ContractDraft, { kind: 'pending' }>),
                        reason: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Expected by" error={errors['contract.expectedBy']}>
                <DateField
                  value={
                    (values.contract as Extract<ContractDraft, { kind: 'pending' }>).expectedBy
                  }
                  onChange={(next) =>
                    onPatch({
                      contract: {
                        ...(values.contract as Extract<ContractDraft, { kind: 'pending' }>),
                        expectedBy: next,
                      },
                    })
                  }
                />
              </Field>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'prior-records',
      title: 'Prior records',
      description: 'Previous bills, contracts, receipts — optional',
      render: ({ values, onPatch }) => (
        <PriorRecordsStep
          entityType="vendor"
          documents={values.documents}
          onChange={(documents) => onPatch({ documents })}
        />
      ),
    },
    {
      id: 'custom',
      title: 'Custom fields',
      description: 'Org-defined via the Form Builder',
      render: ({ values, onPatch }) => (
        <CustomFieldsStep
          entityType="vendor"
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
      render: ({ values, onPatch }) => (
        <div className="space-y-3">
          <Field label="Internal notes (optional)" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={values.notes}
              onChange={(e) => onPatch({ notes: e.target.value })}
              placeholder="Payment quirks, preferred POC, etc."
            />
          </Field>
          <pre className="bg-muted/40 max-h-80 overflow-auto rounded-md p-3 text-xs">
            {JSON.stringify(values, (_, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v), 2)}
          </pre>
        </div>
      ),
    },
  ];

  async function handleSubmit(values: VendorValues) {
    const paymentTermsDays =
      values.paymentTermsDays.trim() === ''
        ? undefined
        : Number.parseInt(values.paymentTermsDays, 10);

    const contractInput =
      values.contract.kind === 'signed'
        ? {
            kind: 'signed' as const,
            uploadedFileName: values.contract.uploadedFileName || 'contract',
            signedAt: values.contract.signedAt,
          }
        : {
            kind: 'pending' as const,
            reason: values.contract.reason,
            expectedBy: values.contract.expectedBy,
          };

    const result = await createVendor({
      name: values.name,
      category: values.category || undefined,
      primaryEmail: values.primaryEmail || undefined,
      primaryPhone: values.primaryPhone || undefined,
      pan: values.pan || undefined,
      gstin: values.gstin || undefined,
      msme: values.msme || undefined,
      registeredAddress: values.registeredAddress || undefined,
      paymentTermsDays:
        paymentTermsDays !== undefined && Number.isFinite(paymentTermsDays)
          ? paymentTermsDays
          : undefined,
      notes: values.notes || undefined,
      contacts: values.contacts
        .filter((c) => c.name.trim() || c.email.trim() || c.phone.trim())
        .map((c) => ({
          name: c.name,
          role: c.title || undefined,
          email: c.email || undefined,
          phone: c.phone || undefined,
          isPrimary: c.isPrimary,
        })),
      bank: {
        bankName: values.bank.bankName || undefined,
        accountNumber: values.bank.accountNumber || undefined,
        ifsc: values.bank.ifsc || undefined,
        holderName: values.bank.holderName || undefined,
      },
      contract: contractInput,
    });

    if (!result.ok) return result;

    // Post-create: upload the signed contract + prior records + custom values.
    const documents: DocumentDraft[] = [...values.documents];
    if (values.contract.kind === 'signed' && values.contract.file) {
      documents.push({
        uid: 'contract',
        file: values.contract.file,
        kind: 'contract',
        title: 'Signed contract',
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
        entityType: 'vendor',
        entityId: result.id,
        documents,
        customValues,
      });
      if (post.failures.length > 0) {
        toast.warning(`Vendor created, but ${post.failures.length} attachment(s) failed.`, {
          description: `${post.failures.slice(0, 3).join('; ')} — re-add these from the vendor's Documents tab.`,
          duration: 10000,
        });
      } else if (post.uploaded > 0 || post.customSaved > 0) {
        toast.success(`Filed ${post.uploaded} document(s).`);
      }
    }

    router.push(`/vendors/${result.id}`);
    return result;
  }

  return (
    <CreationWizard<VendorValues>
      title="Create a vendor"
      steps={steps}
      initialValues={INITIAL}
      onSubmit={handleSubmit}
      onCancel={() => router.push('/vendors')}
    />
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
