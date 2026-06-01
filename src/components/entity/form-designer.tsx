'use client';

import { useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import type { FormField, FormFieldType, FormTemplate } from './form-template-types';

const FIELD_TYPE_OPTIONS: { value: FormFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency (₹)' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'select', label: 'Single select' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'file', label: 'File upload' },
  { value: 'gstin', label: 'GSTIN' },
  { value: 'pan', label: 'PAN' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
  { value: 'address', label: 'Address' },
  { value: 'relation', label: 'Relation' },
];

export type FormDesignerProps = {
  template: FormTemplate;
  /** Called whenever the template should be persisted (debounced by host). */
  onChange: (next: FormTemplate) => void;
  /**
   * Locks: keys + types whose data already exists. The designer prevents
   * editing those fields and instead offers "deprecate & replace".
   * Map keys are FormField.id.
   */
  fieldsWithData?: ReadonlySet<string>;
  /**
   * Called when the admin tightens an optional field to required. Backend
   * returns the count of entities missing this value so the UI can show the
   * backfill choice (bulk-fill / per-entity / grandfather).
   */
  onTightenRequired?: (fieldId: string) => Promise<{ missingCount: number }>;
  className?: string;
};

/**
 * Form Builder admin UI (AUDIT-GAPS §2.2 + §2.4).
 *
 * - Drag-reorder fields (HTML5 drag, no extra deps).
 * - Add / edit / soft-delete fields.
 * - Type picker.
 * - Locked rules: key immutable once data exists; type immutable once data
 *   exists; tightening required triggers `onTightenRequired`.
 *
 * Pure props-in / events-out. The server-action wiring lives in the consumer
 * (Dashboard route at `app/(app)/settings/forms/...`).
 */
export function FormDesigner({
  template,
  onChange,
  fieldsWithData,
  onTightenRequired,
  className,
}: FormDesignerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const sortedFields = template.fields
    .filter((f) => !f.deletedAt)
    .toSorted((a, b) => a.orderIndex - b.orderIndex);

  function patchField(id: string, patch: Partial<FormField>) {
    onChange({
      ...template,
      fields: template.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  }

  function addField() {
    const nextOrder = sortedFields.length;
    const newField: FormField = {
      id: `tmp-${Date.now()}`,
      key: `new_field_${nextOrder + 1}`,
      label: 'New field',
      type: 'text',
      isRequired: false,
      orderIndex: nextOrder,
    };
    onChange({ ...template, fields: [...template.fields, newField] });
    setEditingId(newField.id);
  }

  function deleteField(id: string) {
    onChange({
      ...template,
      fields: template.fields.map((f) =>
        f.id === id ? { ...f, deletedAt: new Date().toISOString() } : f,
      ),
    });
    if (editingId === id) setEditingId(null);
  }

  function moveField(from: number, to: number) {
    if (from === to) return;
    const arr = sortedFields.slice();
    const [moved] = arr.splice(from, 1);
    if (!moved) return;
    arr.splice(to, 0, moved);
    const remaining = template.fields.filter((f) => !!f.deletedAt);
    onChange({
      ...template,
      fields: [...arr.map((f, i) => ({ ...f, orderIndex: i })), ...remaining],
    });
  }

  async function handleTightenRequired(fieldId: string, nextRequired: boolean) {
    if (!nextRequired) {
      patchField(fieldId, { isRequired: false });
      return;
    }
    if (onTightenRequired) {
      const { missingCount } = await onTightenRequired(fieldId);
      if (missingCount > 0) {
        const ok = window.confirm(
          `${missingCount} existing record(s) don't have a value for this field. ` +
            'Marking it required now means those records will fail validation until you backfill. Continue?',
        );
        if (!ok) return;
      }
    }
    patchField(fieldId, { isRequired: true });
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {template.name}
            <span className="text-muted-foreground ml-1.5 text-xs font-normal">
              v{template.version}
            </span>
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            Drag to reorder. Once a field has data, its key and type lock — the label and required
            flag can still change.
          </p>
        </div>
        <Button size="sm" onClick={addField}>
          <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
          Add field
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {sortedFields.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No fields yet. Click <strong>Add field</strong> to start the template.
          </p>
        ) : null}
        <ul className="space-y-2">
          {sortedFields.map((field, index) => {
            const hasData = fieldsWithData?.has(field.id) ?? false;
            const isEditing = editingId === field.id;
            return (
              <li
                key={field.id}
                draggable
                onDragStart={() => setDragFrom(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom !== null) moveField(dragFrom, index);
                  setDragFrom(null);
                }}
                className={cn(
                  'flex flex-col gap-2 rounded-md border p-3',
                  isEditing && 'border-primary',
                  dragFrom === index && 'opacity-50',
                )}
              >
                <div className="flex items-start gap-2">
                  <GripVerticalIcon
                    className="text-muted-foreground mt-1 size-4 cursor-grab"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{field.label}</span>
                      <span className="text-muted-foreground font-mono text-xs">{field.key}</span>
                      <StatusBadge tone="neutral" label={field.type} dot={false} />
                      {field.isRequired ? (
                        <StatusBadge tone="warning" label="Required" dot={false} />
                      ) : null}
                      {hasData ? (
                        <span
                          className="text-muted-foreground inline-flex items-center gap-1 text-xs"
                          title="Field has data — key and type are locked"
                        >
                          <EyeIcon className="size-3" aria-hidden />
                          has data
                        </span>
                      ) : null}
                    </div>
                    {field.helpText ? (
                      <p className="text-muted-foreground mt-0.5 text-xs">{field.helpText}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveField(index, Math.max(0, index - 1))}
                      disabled={index === 0}
                      aria-label="Move up"
                    >
                      <ChevronUpIcon className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveField(index, Math.min(sortedFields.length - 1, index + 1))}
                      disabled={index === sortedFields.length - 1}
                      aria-label="Move down"
                    >
                      <ChevronDownIcon className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(isEditing ? null : field.id)}
                      aria-label="Edit field"
                    >
                      <PencilIcon className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteField(field.id)}
                      aria-label="Soft-delete field"
                    >
                      <Trash2Icon className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>

                {isEditing ? (
                  <FieldEditor
                    field={field}
                    fieldHasData={hasData}
                    onPatch={(patch) => patchField(field.id, patch)}
                    onTightenRequired={(next) => handleTightenRequired(field.id, next)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function FieldEditor({
  field,
  fieldHasData,
  onPatch,
  onTightenRequired,
}: {
  field: FormField;
  fieldHasData: boolean;
  onPatch: (patch: Partial<FormField>) => void;
  onTightenRequired: (next: boolean) => void;
}) {
  return (
    <div className="border-t pt-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`label-${field.id}`} className="text-xs">
            Label
          </Label>
          <Input
            id={`label-${field.id}`}
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`key-${field.id}`} className="text-xs">
            Key (snake_case)
            {fieldHasData ? (
              <span className="text-muted-foreground ml-1 inline-flex items-center gap-1">
                <EyeOffIcon className="size-3" aria-hidden />
                locked
              </span>
            ) : null}
          </Label>
          <Input
            id={`key-${field.id}`}
            value={field.key}
            disabled={fieldHasData}
            onChange={(e) =>
              onPatch({ key: e.target.value.replace(/[^a-z0-9_]/g, '_').toLowerCase() })
            }
            className="font-mono"
          />
        </div>
        <div>
          <Label htmlFor={`type-${field.id}`} className="text-xs">
            Type {fieldHasData ? <span className="text-muted-foreground">(locked)</span> : null}
          </Label>
          <Select
            value={field.type}
            disabled={fieldHasData}
            onValueChange={(v) => onPatch({ type: v as FormFieldType })}
          >
            <SelectTrigger id={`type-${field.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`help-${field.id}`} className="text-xs">
            Help text
          </Label>
          <Input
            id={`help-${field.id}`}
            value={field.helpText ?? ''}
            onChange={(e) => onPatch({ helpText: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`required-${field.id}`}
            checked={field.isRequired}
            onCheckedChange={(c) => onTightenRequired(Boolean(c))}
          />
          <Label htmlFor={`required-${field.id}`} className="text-xs">
            Required
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`column-${field.id}`}
            checked={Boolean(field.isTableColumn)}
            onCheckedChange={(c) => onPatch({ isTableColumn: Boolean(c) })}
          />
          <Label htmlFor={`column-${field.id}`} className="text-xs">
            Show as table column
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`visible-${field.id}`}
            checked={Boolean(field.defaultTableVisible)}
            onCheckedChange={(c) => onPatch({ defaultTableVisible: Boolean(c) })}
            disabled={!field.isTableColumn}
          />
          <Label htmlFor={`visible-${field.id}`} className="text-xs">
            Visible by default
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`searchable-${field.id}`}
            checked={Boolean(field.isSearchable)}
            onCheckedChange={(c) => onPatch({ isSearchable: Boolean(c) })}
          />
          <Label htmlFor={`searchable-${field.id}`} className="text-xs">
            Searchable in Cmd+K
          </Label>
        </div>
      </div>
    </div>
  );
}
