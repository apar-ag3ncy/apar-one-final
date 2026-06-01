'use server';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { formFields, formTemplates } from '@/lib/db/schema';
import { getActorContext } from '@/lib/server/actor';
import type {
  FormField as UiFormField,
  FormFieldOptions,
  FormFieldType,
  FormTemplate as UiFormTemplate,
} from '@/components/entity/form-template-types';

/**
 * Read layer for the Form Builder. The Designer's writes already exist
 * (`custom-values.ts` for values; template authoring is on the settings
 * page), but until now there was no server action to FETCH the active
 * template for an entity type — the wizards' "Custom fields" step and the
 * profile "Custom fields" tab both need it.
 *
 * Returns the shape `@/components/entity/form-template-types` declares so
 * `<FormRenderer>` consumes it directly. `entity_custom_values.value` is
 * keyed by `form_fields.id`, which is exactly the value-bag key the
 * renderer expects.
 */

type FormTemplateEntityType = 'client' | 'vendor' | 'employee' | 'project' | 'office';

function rowToUiField(row: typeof formFields.$inferSelect): UiFormField {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    helpText: row.helpText,
    type: row.type as FormFieldType,
    isRequired: row.isRequired,
    isUnique: row.isUnique,
    isTableColumn: row.isTableColumn,
    defaultTableVisible: row.defaultTableVisible,
    isSearchable: row.isSearchable,
    defaultValue: row.defaultValue ?? undefined,
    options: (row.options as FormFieldOptions | null) ?? null,
    visibilityRoles: row.visibilityRoles ?? undefined,
    orderIndex: row.orderIndex,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * Fetch the single active form template for an entity type, with its
 * non-deleted fields ordered by `orderIndex`. Returns `null` when no
 * active template exists — callers render an empty/placeholder state.
 */
export async function getActiveFormTemplate(
  entityType: FormTemplateEntityType,
): Promise<UiFormTemplate | null> {
  await getActorContext();

  const templateRows = await db
    .select()
    .from(formTemplates)
    .where(
      and(
        eq(formTemplates.entityType, entityType),
        eq(formTemplates.isActive, true),
        isNull(formTemplates.deletedAt),
      ),
    )
    .limit(1);

  const template = templateRows[0];
  if (!template) return null;

  const fieldRows = await db
    .select()
    .from(formFields)
    .where(and(eq(formFields.formTemplateId, template.id), isNull(formFields.deletedAt)))
    .orderBy(asc(formFields.orderIndex));

  return {
    id: template.id,
    entityType: template.entityType,
    name: template.name,
    version: template.version,
    isActive: template.isActive,
    fields: fieldRows.map(rowToUiField),
    createdAt: template.createdAt.toISOString(),
    createdBy: template.createdBy,
  };
}
