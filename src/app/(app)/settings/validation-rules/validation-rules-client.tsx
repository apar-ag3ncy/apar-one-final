'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatPaiseForInput } from '@/components/shared/format-inr';
import type { ValidationRule } from '@/types/api';

export function ValidationRulesClient({ initial }: { initial: readonly ValidationRule[] }) {
  const [rules, setRules] = useState<ValidationRule[]>(() => initial.map((r) => ({ ...r })));

  function toggle(code: string) {
    setRules((current) =>
      current.map((r) => (r.code === code ? { ...r, enabled: !r.enabled } : r)),
    );
    // TODO(backend): A.setValidationRule(code, { enabled }).
  }

  function patchThreshold(code: string, value: string) {
    setRules((current) =>
      current.map((r) => {
        if (r.code !== code) return r;
        if (value === '') return { ...r, thresholdPaise: null };
        try {
          return { ...r, thresholdPaise: BigInt(Math.round(Number(value) * 100)) };
        } catch {
          return r;
        }
      }),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rules</CardTitle>
        <p className="text-muted-foreground text-xs">
          Changes take effect immediately for new draft transactions. Already-posted transactions
          don&apos;t get re-validated.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Rule</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead className="text-right">Threshold ₹</TableHead>
              <TableHead className="text-center">Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.code}>
                <TableCell>
                  <p className="font-medium">{rule.label}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">{rule.description}</p>
                  <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">{rule.code}</p>
                </TableCell>
                <TableCell>
                  <StatusBadge
                    tone={rule.severity === 'block' ? 'danger' : 'warning'}
                    label={rule.severity.toUpperCase()}
                    dot={false}
                  />
                </TableCell>
                <TableCell className="text-right">
                  {rule.thresholdPaise !== null && rule.thresholdPaise !== undefined ? (
                    <Input
                      type="text"
                      inputMode="decimal"
                      defaultValue={formatPaiseForInput(rule.thresholdPaise ?? 0n)}
                      onChange={(e) => patchThreshold(rule.code, e.target.value)}
                      className="ml-auto w-28 text-right font-mono tabular-nums"
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox checked={rule.enabled} onCheckedChange={() => toggle(rule.code)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
