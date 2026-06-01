'use client';

import { useMemo } from 'react';
import { CheckIcon, MinusIcon, PencilIcon } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencyInput } from '@/components/shared/currency-input';
import { formatINR } from '@/components/shared/format-inr';
import { cn } from '@/lib/utils';
import type { FormField, FormTemplate, FormValues } from './form-template-types';

export type FormRendererMode = 'view' | 'edit';

export type FormRendererProps = {
  template: FormTemplate;
  values: FormValues;
  mode: FormRendererMode;
  /** Edit-mode change handler. Called with (fieldId, newValue). */
  onChange?: (fieldId: string, value: unknown) => void;
  /** Field-level error messages keyed by FormField.id. */
  errors?: Record<string, string>;
  /** Show a CTA to switch from view → edit. */
  onRequestEdit?: () => void;
  /** Hide soft-deleted fields when set false (default true). */
  hideDeletedFields?: boolean;
  /** Filter visible fields by current user's roles. */
  userRoles?: readonly string[];
  className?: string;
};

/**
 * Template-driven entity form. Renders a `FormTemplate` against a `values` bag.
 *
 * Pure data-in/data-out — no fetching, no router, no Supabase. The consumer
 * supplies a value bag (typically from React Query) and an onChange handler
 * that pushes to a server action.
 */
export function FormRenderer({
  template,
  values,
  mode,
  onChange,
  errors,
  onRequestEdit,
  hideDeletedFields = true,
  userRoles,
  className,
}: FormRendererProps) {
  const fields = useMemo(() => {
    return template.fields
      .filter((f) => (hideDeletedFields ? !f.deletedAt : true))
      .filter((f) => isVisible(f, userRoles))
      .toSorted((a, b) => a.orderIndex - b.orderIndex);
  }, [template.fields, hideDeletedFields, userRoles]);

  if (fields.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="text-muted-foreground py-6 text-center text-sm">
          No custom fields defined for this template yet.
          {onRequestEdit ? (
            <Button variant="link" size="sm" className="ml-1 px-1" onClick={onRequestEdit}>
              Open Form Builder
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">
          {template.name}
          <span className="text-muted-foreground ml-1.5 text-xs font-normal">
            v{template.version}
          </span>
        </CardTitle>
        {mode === 'view' && onRequestEdit ? (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onRequestEdit}>
            <PencilIcon className="size-3.5" aria-hidden />
            Edit
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <FieldRow
              key={field.id}
              field={field}
              value={values[field.id]}
              mode={mode}
              onChange={onChange ? (v) => onChange(field.id, v) : undefined}
              error={errors?.[field.id]}
            />
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function isVisible(field: FormField, userRoles?: readonly string[]): boolean {
  if (!field.visibilityRoles || field.visibilityRoles.length === 0) return true;
  if (!userRoles || userRoles.length === 0) return true; // optimistic; server enforces
  return field.visibilityRoles.some((r) => userRoles.includes(r));
}

function FieldRow({
  field,
  value,
  mode,
  onChange,
  error,
}: {
  field: FormField;
  value: unknown;
  mode: FormRendererMode;
  onChange?: (v: unknown) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={`field-${field.id}`}
        className="text-muted-foreground text-xs tracking-wide uppercase"
      >
        {field.label}
        {field.isRequired ? <span className="text-destructive ml-1">*</span> : null}
      </Label>
      {mode === 'view' ? (
        <FieldDisplay field={field} value={value} />
      ) : (
        <FieldInput field={field} value={value} onChange={onChange} />
      )}
      {field.helpText ? <p className="text-muted-foreground text-xs">{field.helpText}</p> : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

function FieldDisplay({ field, value }: { field: FormField; value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  switch (field.type) {
    case 'currency': {
      const paise = typeof value === 'bigint' ? value : BigInt(value as string);
      return <span className="font-mono text-sm tabular-nums">{formatINR(paise)}</span>;
    }
    case 'date':
    case 'datetime': {
      const d = typeof value === 'string' ? new Date(value) : (value as Date);
      return (
        <span className="text-sm">
          {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      );
    }
    case 'boolean':
      return value ? (
        <CheckIcon className="size-4 text-emerald-600" aria-hidden />
      ) : (
        <MinusIcon className="text-muted-foreground size-4" aria-hidden />
      );
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as readonly string[]) : [];
      return (
        <div className="flex flex-wrap gap-1">
          {arr.map((v) => (
            <span key={v} className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs">
              {field.options?.choices?.find((c) => c.value === v)?.label ?? v}
            </span>
          ))}
        </div>
      );
    }
    case 'select': {
      const label = field.options?.choices?.find((c) => c.value === value)?.label;
      return <span className="text-sm">{label ?? String(value)}</span>;
    }
    case 'gstin':
    case 'pan':
      return <span className="font-mono text-sm">{String(value)}</span>;
    default:
      return <span className="text-sm whitespace-pre-wrap">{String(value)}</span>;
  }
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange?: (v: unknown) => void;
}) {
  const id = `field-${field.id}`;
  const required = field.isRequired;

  switch (field.type) {
    case 'longtext':
      return (
        <Textarea
          id={id}
          value={(value as string) ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
          rows={4}
        />
      );
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={(value as number | string) ?? ''}
          onChange={(e) => onChange?.(e.target.value === '' ? null : Number(e.target.value))}
          required={required}
        />
      );
    case 'currency':
      return (
        <CurrencyInput
          id={id}
          value={typeof value === 'bigint' ? value : null}
          onValueChange={(p) => onChange?.(p)}
          required={required}
        />
      );
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
        />
      );
    case 'datetime':
      return (
        <Input
          id={id}
          type="datetime-local"
          value={typeof value === 'string' ? value.slice(0, 16) : ''}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
        />
      );
    case 'select':
      return (
        <Select value={(value as string) ?? ''} onValueChange={(v) => onChange?.(v)}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {field.options?.choices?.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multiselect': {
      const selected = new Set(Array.isArray(value) ? (value as readonly string[]) : []);
      return (
        <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
          {field.options?.choices?.map((c) => {
            const isSelected = selected.has(c.value);
            return (
              <button
                type="button"
                key={c.value}
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(c.value)) next.delete(c.value);
                  else next.add(c.value);
                  onChange?.(Array.from(next));
                }}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs',
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      );
    }
    case 'boolean':
      return (
        <Checkbox
          id={id}
          checked={Boolean(value)}
          onCheckedChange={(c) => onChange?.(Boolean(c))}
        />
      );
    case 'gstin':
    case 'pan':
      return (
        <Input
          id={id}
          type="text"
          className="font-mono uppercase"
          value={(value as string) ?? ''}
          onChange={(e) => onChange?.(e.target.value.toUpperCase())}
          required={required}
        />
      );
    case 'email':
      return (
        <Input
          id={id}
          type="email"
          value={(value as string) ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
        />
      );
    case 'phone':
      return (
        <Input
          id={id}
          type="tel"
          value={(value as string) ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
        />
      );
    case 'url':
      return (
        <Input
          id={id}
          type="url"
          value={(value as string) ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
        />
      );
    // file / address / relation — consumer renders a custom field via a slot
    case 'file':
    case 'address':
    case 'relation':
      return (
        <div className="text-muted-foreground bg-muted/40 rounded-md border p-2 text-xs">
          {field.type} field renderer requires a host-provided component slot.
        </div>
      );
    default:
      return (
        <Input
          id={id}
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
        />
      );
  }
}
