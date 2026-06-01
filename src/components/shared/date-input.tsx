'use client';

import * as React from 'react';
import { format, isValid } from 'date-fns';
import { CalendarIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type DateInputProps = {
  value: Date | null;
  onValueChange: (date: Date | null) => void;
  placeholder?: string;
  /** Disable the trigger. */
  disabled?: boolean;
  /** Show a small clear button when a date is selected. Default: true. */
  clearable?: boolean;
  /** Display format (date-fns tokens). Default: DD MMM YYYY. */
  displayFormat?: string;
  /** Min / max bounds passed to react-day-picker. */
  fromDate?: Date;
  toDate?: Date;
  className?: string;
  invalid?: boolean;
  /** Optional id so a parent <FormLabel> can htmlFor= it. */
  id?: string;
};

// TODO(backend): once @/lib/date ships formatDateIST, swap the format() call for that helper
// so display is always IST regardless of viewer timezone.
export function DateInput({
  value,
  onValueChange,
  placeholder = 'Pick a date',
  disabled,
  clearable = true,
  displayFormat = 'dd MMM yyyy',
  fromDate,
  toDate,
  className,
  invalid,
  id,
}: DateInputProps) {
  const [open, setOpen] = React.useState(false);
  const display = value && isValid(value) ? format(value, displayFormat) : '';
  return (
    <div className={cn('relative flex w-full', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid ? true : undefined}
            className={cn(
              'h-9 w-full justify-start text-left font-normal',
              !display && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="size-4" aria-hidden />
            {display || placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={value ?? undefined}
            onSelect={(next) => {
              onValueChange(next ?? null);
              setOpen(false);
            }}
            startMonth={fromDate}
            endMonth={toDate}
            disabled={
              fromDate || toDate
                ? (date) => {
                    if (fromDate && date < fromDate) return true;
                    if (toDate && date > toDate) return true;
                    return false;
                  }
                : undefined
            }
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {clearable && value && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear date"
          onClick={() => onValueChange(null)}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
        >
          <XIcon className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
