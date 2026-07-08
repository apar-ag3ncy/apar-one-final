'use client';

// Thin adapter over DateInput for the `value: 'YYYY-MM-DD' string` /
// `onChange(string)` shape every existing form uses — so swapping a native
// `<input type="date">` for the brand-orange in-app calendar (item 2) is a
// one-line change per site. The underlying DateInput renders the shadcn
// Calendar, which is themed via --calendar-accent.

import * as React from 'react';
import { isValid, parseISO } from 'date-fns';

import { DateInput } from '@/components/shared/date-input';

/** Local date → 'YYYY-MM-DD' (avoids the UTC shift toISOString() would add). */
function toIso(d: Date | null): string {
  if (!d || !isValid(d)) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM-DD' → local Date (noon avoids DST edge-of-day surprises). */
function fromIso(s: string): Date | null {
  if (!s) return null;
  const d = parseISO(`${s}T12:00:00`);
  return isValid(d) ? d : null;
}

export type DateFieldProps = {
  /** ISO date string 'YYYY-MM-DD', or '' for empty. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** ISO min / max bounds. */
  min?: string;
  max?: string;
  className?: string;
  invalid?: boolean;
  id?: string;
};

export function DateField({
  value,
  onChange,
  placeholder,
  disabled,
  clearable,
  min,
  max,
  className,
  invalid,
  id,
}: DateFieldProps) {
  return (
    <DateInput
      id={id}
      value={fromIso(value)}
      onValueChange={(d) => onChange(toIso(d))}
      placeholder={placeholder}
      disabled={disabled}
      clearable={clearable}
      fromDate={min ? (fromIso(min) ?? undefined) : undefined}
      toDate={max ? (fromIso(max) ?? undefined) : undefined}
      className={className}
      invalid={invalid}
    />
  );
}
