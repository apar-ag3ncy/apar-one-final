/**
 * Form Builder schema types (AUDIT-GAPS §2.2). These mirror the eventual
 * `form_templates` / `form_fields` tables. Backend (Session A) will replace
 * this module with a generated Zod-schema-derived export once it ships.
 *
 * Rules baked in (AUDIT-GAPS §2.2 — locked):
 *   - Field `key` is immutable once data exists; the label can change.
 *   - Type changes are forbidden once data exists.
 *   - Required can only be tightened via a backfill flow; UI exposes choices
 *     (bulk-fill / per-entity-fill / grandfather).
 *   - Soft-delete only.
 */

export type FormFieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency' // stored as bigint paise
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'file'
  | 'gstin'
  | 'pan'
  | 'phone'
  | 'email'
  | 'url'
  | 'boolean'
  | 'address'
  | 'relation';

export type FormFieldOption = {
  value: string;
  label: string;
};

/**
 * `options` jsonb shape. The interpretation depends on the field type:
 *   - select / multiselect → { choices: FormFieldOption[] }
 *   - text / longtext     → { min?: number; max?: number; regex?: string }
 *   - number / currency   → { min?: number; max?: number; step?: number }
 *   - relation            → { entityType: EntityType; allowCreate?: boolean }
 *   - file                → { mimeTypes?: string[]; maxBytes?: number }
 */
export type FormFieldOptions = {
  choices?: readonly FormFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  regex?: string;
  entityType?: string;
  allowCreate?: boolean;
  mimeTypes?: readonly string[];
  maxBytes?: number;
};

export type FormField = {
  id: string;
  /** snake_case immutable key. */
  key: string;
  /** Display label — editable. */
  label: string;
  helpText?: string | null;
  type: FormFieldType;
  isRequired: boolean;
  isUnique?: boolean;
  /** Whether to surface this field as a DataTable column by default. */
  isTableColumn?: boolean;
  defaultTableVisible?: boolean;
  /** Searchable in Cmd+K (server uses pg_trgm). */
  isSearchable?: boolean;
  defaultValue?: unknown;
  options?: FormFieldOptions | null;
  /** Roles that can view/edit this field. Empty = all roles. */
  visibilityRoles?: readonly string[];
  orderIndex: number;
  deletedAt?: string | Date | null;
};

export type FormTemplate = {
  id: string;
  entityType: 'client' | 'vendor' | 'employee' | 'project' | (string & {});
  name: string;
  version: number;
  isActive: boolean;
  fields: readonly FormField[];
  createdAt: string | Date;
  createdBy?: string | null;
};

/** Value bag keyed by FormField.id. */
export type FormValues = Record<string, unknown>;
