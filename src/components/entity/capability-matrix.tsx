'use client';

import { CheckIcon, LockIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
  CAPABILITY_GROUPS,
  CAPABILITY_LABELS,
  ROLE_LABELS,
  ROLES,
  type Capability,
  type Role,
} from './capability-types';

export type CapabilityGrants = Record<Role, ReadonlySet<Capability>>;

export type CapabilityMatrixProps = {
  grants: CapabilityGrants;
  /**
   * Called when the user toggles a single cell. The consumer translates this
   * into a server action (grant or revoke).
   *
   * Partner row is read-only — its cells render a lock icon and don't call
   * onToggle. Server should also reject any attempt to change partner.
   */
  onToggle?: (role: Role, capability: Capability, next: boolean) => void;
  /** Disable interaction (e.g. when current user lacks `manage_capabilities`). */
  readOnly?: boolean;
  className?: string;
};

/**
 * Role × Capability matrix UI (AUDIT-GAPS §3 + amendment).
 *
 * Layout: groups of capabilities as horizontal section headers; one row per
 * capability with a checkbox per role. Partner column is always locked.
 *
 * Pure presentational. The audit-logged grant/revoke server actions live in
 * the consumer at `app/(app)/settings/roles/`.
 */
export function CapabilityMatrix({ grants, onToggle, readOnly, className }: CapabilityMatrixProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Role capabilities</CardTitle>
        <p className="text-muted-foreground text-xs">
          The partner role always has every capability — its cells are locked. Every grant or revoke
          writes an entry to the audit log.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="text-muted-foreground px-4 py-2 text-left text-xs tracking-wide uppercase">
                  Capability
                </th>
                {ROLES.map((role) => (
                  <th
                    key={role}
                    className="text-muted-foreground w-24 px-2 py-2 text-center text-xs tracking-wide uppercase"
                  >
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_GROUPS.map((group) => (
                <CapabilityGroupRows
                  key={group.label}
                  label={group.label}
                  capabilities={group.capabilities}
                  grants={grants}
                  onToggle={onToggle}
                  readOnly={readOnly}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function CapabilityGroupRows({
  label,
  capabilities,
  grants,
  onToggle,
  readOnly,
}: {
  label: string;
  capabilities: readonly Capability[];
  grants: CapabilityGrants;
  onToggle?: (role: Role, capability: Capability, next: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <>
      <tr className="bg-muted/20 border-t">
        <td
          colSpan={ROLES.length + 1}
          className="text-muted-foreground px-4 py-1.5 text-xs font-medium tracking-wide uppercase"
        >
          {label}
        </td>
      </tr>
      {capabilities.map((capability) => (
        <tr key={capability} className="border-t">
          <td className="px-4 py-2">
            <span className="font-medium">{CAPABILITY_LABELS[capability]}</span>
            <span className="text-muted-foreground ml-2 font-mono text-xs">{capability}</span>
          </td>
          {ROLES.map((role) => {
            const granted = grants[role].has(capability);
            const isPartner = role === 'partner';
            return (
              <td key={role} className={cn('px-2 py-2 text-center', isPartner && 'bg-muted/40')}>
                {isPartner ? (
                  <span
                    className="text-muted-foreground inline-flex items-center justify-center"
                    title="Partner role is locked: always granted, cannot revoke"
                  >
                    <CheckIcon className="size-3.5 text-emerald-600" aria-hidden />
                    <LockIcon className="ml-1 size-3 opacity-50" aria-hidden />
                  </span>
                ) : (
                  <Checkbox
                    checked={granted}
                    disabled={readOnly}
                    onCheckedChange={(next) => onToggle?.(role, capability, Boolean(next))}
                    aria-label={`${ROLE_LABELS[role]} can ${CAPABILITY_LABELS[capability]}`}
                  />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
