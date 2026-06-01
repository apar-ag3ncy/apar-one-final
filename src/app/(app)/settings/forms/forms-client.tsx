'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormDesigner } from '@/components/entity/form-designer';
import { FormRenderer } from '@/components/entity/form-renderer';
import type { FormTemplate, FormValues } from '@/components/entity/form-template-types';

type EntityKind = 'client' | 'vendor' | 'employee' | 'project';

const ENTITY_LABELS: Record<EntityKind, string> = {
  client: 'Clients',
  vendor: 'Vendors',
  employee: 'Employees',
  project: 'Projects',
};

const INITIAL_TEMPLATES: Record<EntityKind, FormTemplate> = {
  client: {
    id: 'tpl-client',
    entityType: 'client',
    name: 'Client custom fields',
    version: 1,
    isActive: true,
    createdAt: new Date().toISOString(),
    fields: [
      {
        id: 'f-anniv',
        key: 'anniversary_date',
        label: 'Anniversary',
        type: 'date',
        isRequired: false,
        orderIndex: 0,
        helpText: 'Used by Marketing for outreach campaigns.',
      },
      {
        id: 'f-courier',
        key: 'preferred_courier',
        label: 'Preferred courier',
        type: 'select',
        isRequired: false,
        orderIndex: 1,
        options: {
          choices: [
            { value: 'bluedart', label: 'BlueDart' },
            { value: 'dtdc', label: 'DTDC' },
            { value: 'delhivery', label: 'Delhivery' },
          ],
        },
      },
    ],
  },
  vendor: {
    id: 'tpl-vendor',
    entityType: 'vendor',
    name: 'Vendor custom fields',
    version: 1,
    isActive: true,
    createdAt: new Date().toISOString(),
    fields: [],
  },
  employee: {
    id: 'tpl-employee',
    entityType: 'employee',
    name: 'Employee custom fields',
    version: 1,
    isActive: true,
    createdAt: new Date().toISOString(),
    fields: [],
  },
  project: {
    id: 'tpl-project',
    entityType: 'project',
    name: 'Project custom fields',
    version: 1,
    isActive: true,
    createdAt: new Date().toISOString(),
    fields: [],
  },
};

/**
 * Form Builder UI host. Per-entity template editor on the left, live preview
 * on the right using `<FormRenderer>` in view mode.
 *
 * TODO(backend): swap the in-state INITIAL_TEMPLATES with server actions
 * (getFormTemplates / saveFormTemplate / countEntitiesMissingField).
 */
export function FormsClient() {
  const [entityKind, setEntityKind] = useState<EntityKind>('client');
  const [templates, setTemplates] = useState(INITIAL_TEMPLATES);
  const [previewValues, setPreviewValues] = useState<FormValues>({});

  const template = templates[entityKind];

  return (
    <Tabs value={entityKind} onValueChange={(v) => setEntityKind(v as EntityKind)}>
      <TabsList>
        {(Object.keys(ENTITY_LABELS) as readonly EntityKind[]).map((kind) => (
          <TabsTrigger key={kind} value={kind}>
            {ENTITY_LABELS[kind]}
          </TabsTrigger>
        ))}
      </TabsList>
      {(Object.keys(ENTITY_LABELS) as readonly EntityKind[]).map((kind) => (
        <TabsContent key={kind} value={kind}>
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <FormDesigner
                template={kind === entityKind ? template : templates[kind]}
                onChange={(next) => setTemplates((all) => ({ ...all, [kind]: next }))}
                // TODO(backend): fieldsWithData from server query.
                onTightenRequired={async (fieldId) => {
                  // TODO(backend): call A.countEntitiesMissingField(fieldId).
                  void fieldId;
                  return { missingCount: 0 };
                }}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base">Live preview</CardTitle>
                  <PreviewModePicker
                    value="view"
                    onChange={() => {
                      /* future: toggle view/edit */
                    }}
                  />
                </CardHeader>
                <CardContent>
                  <FormRenderer
                    template={kind === entityKind ? template : templates[kind]}
                    values={previewValues}
                    mode="edit"
                    onChange={(fieldId, value) =>
                      setPreviewValues((prev) => ({ ...prev, [fieldId]: value }))
                    }
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function PreviewModePicker({
  value,
  onChange,
}: {
  value: 'view' | 'edit';
  onChange: (v: 'view' | 'edit') => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as 'view' | 'edit')}>
      <SelectTrigger className="w-32 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="view">View mode</SelectItem>
        <SelectItem value="edit">Edit mode</SelectItem>
      </SelectContent>
    </Select>
  );
}
