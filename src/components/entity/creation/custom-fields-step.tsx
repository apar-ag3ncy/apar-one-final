'use client';

import { useEffect, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { FormRenderer } from '@/components/entity/form-renderer';
import type { FormTemplate, FormValues } from '@/components/entity/form-template-types';
import { getActiveFormTemplate } from '@/lib/server/entities/form-templates';
import type { CreationEntityType } from './types';

export type CustomFieldsStepProps = {
  entityType: CreationEntityType;
  values: FormValues;
  onChange: (values: FormValues) => void;
  /** Lets the parent learn the active template (to map values → form_fields). */
  onTemplateLoaded?: (template: FormTemplate | null) => void;
};

/**
 * Wizard step that renders the org's active Form-Builder template for this
 * entity type. Replaces the old static placeholder. When no active template
 * exists it shows a friendly note — the step never blocks creation.
 *
 * Values are keyed by `form_fields.id`, exactly what `createCustomValue`
 * expects as `formFieldId`, so the post-create orchestrator can persist them
 * with no remapping.
 */
export function CustomFieldsStep({
  entityType,
  values,
  onChange,
  onTemplateLoaded,
}: CustomFieldsStepProps) {
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    // `state` starts at 'loading'; we only flip it from the async callbacks,
    // never synchronously here (that would trigger cascading renders).
    let active = true;
    getActiveFormTemplate(entityType)
      .then((t) => {
        if (!active) return;
        setTemplate(t);
        onTemplateLoaded?.(t);
        setState('ready');
      })
      .catch(() => {
        if (!active) return;
        setState('error');
      });
    return () => {
      active = false;
    };
    // onTemplateLoaded is intentionally excluded — parents pass a fresh fn each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  if (state === 'loading') {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
        Loading custom fields…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        Couldn&apos;t load the custom-fields template. You can still finish — add these later from
        the profile.
      </div>
    );
  }

  if (!template || template.fields.length === 0) {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        No custom fields are configured for {entityType}s yet. An admin can define them in{' '}
        <span className="font-medium">Settings → Forms</span>. This step is optional.
      </div>
    );
  }

  return (
    <FormRenderer
      template={template}
      values={values}
      mode="edit"
      onChange={(fieldId, value) => onChange({ ...values, [fieldId]: value })}
    />
  );
}
