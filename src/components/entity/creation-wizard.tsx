'use client';

import { useState } from 'react';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type WizardStep<TValues> = {
  id: string;
  title: string;
  description?: string;
  /**
   * Render the step's form body. Receive the current values and a
   * `onPatch` updater (merges shallowly).
   */
  render: (args: {
    values: TValues;
    onPatch: (patch: Partial<TValues>) => void;
    /** Field-level errors keyed by path. Server fills these. */
    errors: Record<string, string>;
  }) => React.ReactNode;
  /**
   * Optional client-side validator. Return `{}` to advance; return an
   * object of `{ [path]: message }` to block.
   *
   * Server-side validation runs on submit regardless and overrides any
   * "looks fine" client decision.
   */
  validate?: (values: TValues) => Record<string, string>;
};

export type CreationWizardProps<TValues> = {
  title: string;
  steps: readonly WizardStep<TValues>[];
  initialValues: TValues;
  /** Called once on the final step's confirm. */
  onSubmit: (
    values: TValues,
  ) => Promise<
    { ok: true; id: string } | { ok: false; errors: Record<string, string>; message?: string }
  >;
  /** Called when the user cancels (back-link or X). */
  onCancel?: () => void;
};

/**
 * Generic 7-step (or any-N-step) entity creation wizard (AUDIT-GAPS §4.2).
 *
 * Surface-agnostic: no `next/navigation`, no Supabase. The host wires
 * `onSubmit` to the create-entity server action and `onCancel` to navigate
 * away. The wizard manages step state, per-step validation, and surfaces
 * server-returned field errors inline.
 */
export function CreationWizard<TValues>({
  title,
  steps,
  initialValues,
  onSubmit,
  onCancel,
}: CreationWizardProps<TValues>) {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<TValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const step = steps[stepIndex]!;
  const isLast = stepIndex === steps.length - 1;
  const isFirst = stepIndex === 0;

  function patchValues(patch: Partial<TValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function attemptAdvance() {
    const stepErrors = step.validate ? step.validate(values) : {};
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStepIndex((i) => i + 1);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setServerMessage(null);
    const result = await onSubmit(values);
    setSubmitting(false);
    if (!result.ok) {
      setErrors(result.errors);
      setServerMessage(result.message ?? null);
      // Jump to the first step that has an error.
      const firstErrorPath = Object.keys(result.errors)[0];
      if (firstErrorPath) {
        const stepWithError = steps.findIndex(
          (s) => (s.validate?.(values) ?? {})[firstErrorPath] !== undefined,
        );
        if (stepWithError >= 0) setStepIndex(stepWithError);
      }
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            <p className="text-muted-foreground text-xs">
              Step {stepIndex + 1} of {steps.length} · {step.title}
              {step.description ? ` — ${step.description}` : ''}
            </p>
          </div>
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <StepIndicator steps={steps} currentIndex={stepIndex} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-6">
          {step.render({ values, onPatch: patchValues, errors })}
        </CardContent>
      </Card>

      {serverMessage ? (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <CircleAlertIcon className="text-destructive size-4" aria-hidden />
            <span className="text-destructive">{serverMessage}</span>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={isFirst || submitting}
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeftIcon className="mr-1.5 size-3.5" aria-hidden />
          Back
        </Button>
        {isLast ? (
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Create'}
            <CheckIcon className="ml-1.5 size-3.5" aria-hidden />
          </Button>
        ) : (
          <Button onClick={attemptAdvance} disabled={submitting}>
            Continue
            <ChevronRightIcon className="ml-1.5 size-3.5" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function StepIndicator<TValues>({
  steps,
  currentIndex,
}: {
  steps: readonly WizardStep<TValues>[];
  currentIndex: number;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-3">
      {steps.map((step, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <li
            key={step.id}
            className={cn(
              'flex items-center gap-2 text-xs',
              isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border text-[10px]',
                isDone
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : isCurrent
                    ? 'border-primary text-primary'
                    : 'border-border',
              )}
            >
              {isDone ? <CheckIcon className="size-3" aria-hidden /> : i + 1}
            </span>
            {step.title}
          </li>
        );
      })}
    </ol>
  );
}
