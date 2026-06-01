'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatPaiseForInput, parseRupeesToPaise } from './format-inr';

type CurrencyInputProps = Omit<
  React.ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> & {
  /** Paise as bigint. null = empty input. */
  value: bigint | null;
  onValueChange: (paise: bigint | null) => void;
  /** Optional callback fired on the underlying input blur with the same paise value. */
  onValueBlur?: (paise: bigint | null) => void;
  className?: string;
  invalid?: boolean;
};

/**
 * Indian-grouped currency input.
 *
 * - During focus the raw string the user typed is preserved (so you can keep typing through commas).
 * - On blur, the value is normalised to grouped format with 2 decimals via formatPaiseForInput.
 * - Emits paise (bigint) via onValueChange. Use formatINR() at the display site.
 */
export function CurrencyInput({
  value,
  onValueChange,
  onValueBlur,
  className,
  invalid,
  onFocus,
  onBlur,
  ...rest
}: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = React.useState(() => formatPaiseForInput(value));
  const isFocusedRef = React.useRef(false);

  // Sync external value into display when input is not focused.
  React.useEffect(() => {
    if (!isFocusedRef.current) {
      setDisplayValue(formatPaiseForInput(value));
    }
  }, [value]);

  return (
    <div className="relative">
      <span
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm select-none"
        aria-hidden
      >
        ₹
      </span>
      <Input
        {...rest}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid ? true : undefined}
        className={cn('pl-7 text-right tabular-nums', className)}
        value={displayValue}
        onChange={(event) => {
          const next = event.target.value;
          setDisplayValue(next);
          if (next.trim() === '') {
            onValueChange(null);
            return;
          }
          const paise = parseRupeesToPaise(next);
          if (paise !== null) {
            onValueChange(paise);
          }
        }}
        onFocus={(event) => {
          isFocusedRef.current = true;
          onFocus?.(event);
        }}
        onBlur={(event) => {
          isFocusedRef.current = false;
          const paise = parseRupeesToPaise(displayValue);
          setDisplayValue(formatPaiseForInput(paise));
          onValueBlur?.(paise);
          onBlur?.(event);
        }}
      />
    </div>
  );
}
