'use client';

import { useState, useTransition } from 'react';
import { AlertTriangleIcon, LockIcon, UnlockIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/shared/status-badge';
import { setPeriodStatus } from '@/lib/server-stub/ledger-actions';
import type { Period } from '@/lib/server-stub/ledger-types';

export function PeriodsClient({
  initialPeriods,
  enforceClose,
}: {
  initialPeriods: readonly Period[];
  /** Read server-side from `settings.enforce_period_close` and passed in. */
  enforceClose: boolean;
}) {
  const [periods, setPeriods] = useState<Period[]>(() => initialPeriods.map((p) => ({ ...p })));
  const [reopenTarget, setReopenTarget] = useState<Period | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function transition(periodId: string, next: Period['status'], reason?: string) {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setPeriodStatus({
        periodId,
        next,
        reopenReason: reason,
      });
      if (result.ok) {
        setPeriods((current) =>
          current.map((p) => (p.id === periodId ? { ...p, status: next } : p)),
        );
      } else {
        setErrorMessage(result.message);
      }
    });
  }

  function confirmReopen() {
    if (!reopenTarget) return;
    transition(reopenTarget.id, 'open', reopenReason);
    setReopenTarget(null);
    setReopenReason('');
  }

  return (
    <>
      {!enforceClose ? (
        <Card className="mb-4 border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            <div>
              <p className="font-medium">Soft-close enforcement is advisory only</p>
              <p className="text-muted-foreground text-xs">
                <span className="font-mono">settings.enforce_period_close = false</span>. Hard-closed
                periods still block all postings — that's enforced server-side in <span className="font-mono">postTransaction</span>{' '}
                regardless of this flag. Toggle this on to additionally have the UI warn on drafts
                that target a soft-closed period.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {errorMessage ? (
        <Card className="border-destructive mb-4">
          <CardContent className="text-destructive py-3 text-sm">{errorMessage}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Accounting periods</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Period</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.label}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{p.startDate}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{p.endDate}</TableCell>
                  <TableCell>
                    {p.status === 'open' ? (
                      <StatusBadge tone="info" label="Open" />
                    ) : p.status === 'soft_closed' ? (
                      <StatusBadge tone="warning" label="Soft-closed" />
                    ) : (
                      <StatusBadge tone="danger" label="Hard-closed" />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {p.status === 'open' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => transition(p.id, 'soft_closed')}
                          disabled={pending}
                        >
                          <LockIcon className="mr-1 size-3" aria-hidden />
                          Soft-close
                        </Button>
                      ) : null}
                      {p.status === 'soft_closed' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => transition(p.id, 'hard_closed')}
                          disabled={pending}
                        >
                          <LockIcon className="mr-1 size-3" aria-hidden />
                          Hard-close
                        </Button>
                      ) : null}
                      {p.status !== 'open' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReopenTarget(p)}
                          disabled={pending}
                        >
                          <UnlockIcon className="mr-1 size-3" aria-hidden />
                          Re-open
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog
        open={reopenTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReopenTarget(null);
            setReopenReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-open {reopenTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Re-opening a closed period writes to the audit log and lets transactions be backdated
              into it. Capture why now — partners read this trail at year-end.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Reason (min 10 chars)</Label>
            <Textarea
              rows={3}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reopenReason.trim().length < 10}
              onClick={(e) => {
                e.preventDefault();
                confirmReopen();
              }}
            >
              Re-open
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
