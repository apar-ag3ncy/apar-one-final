'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { BoxesIcon, PlayIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { useCurrentUser } from '@/lib/client/use-current-user';
import { rupeesToPaise } from '@/lib/money';
import {
  createFixedAsset,
  disposeFixedAsset,
  listFixedAssets,
  runDepreciation,
  type FixedAssetRow,
} from '@/lib/server/assets/fixed-assets';

const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  fully_depreciated: { tone: 'neutral', label: 'Fully depreciated' },
  disposed: { tone: 'neutral', label: 'Disposed' },
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AssetsClient() {
  const { hasCapability } = useCurrentUser();
  const canManage = hasCapability('create_journal_voucher');
  const [rows, setRows] = useState<FixedAssetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);

  const reload = useCallback(() => {
    listFixedAssets()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load assets'));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) {
    return <EmptyState icon={BoxesIcon} title="Could not load assets" description={error} />;
  }
  if (rows === null) return <Skeleton className="h-40 w-full" />;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Assets{' '}
            <span className="text-muted-foreground text-xs font-normal">({rows.length})</span>
          </CardTitle>
          {canManage ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setDepOpen(true)}>
                <PlayIcon className="mr-1.5 size-3.5" aria-hidden />
                Run depreciation
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <PlusIcon className="mr-1.5 size-4" aria-hidden />
                Add asset
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={BoxesIcon}
              title="No fixed assets yet"
              description="Add capitalised assets (equipment, furniture, devices) to track their book value and depreciation."
            />
          ) : (
            <ul className="divide-y">
              {rows.map((a) => {
                const st = STATUS[a.status] ?? STATUS.active!;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{a.name}</span>
                        <StatusBadge tone={st.tone} label={st.label} dot={false} />
                        {a.category ? (
                          <span className="text-muted-foreground text-xs">· {a.category}</span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        Acquired {a.acquisitionDate} · cost {formatINR(a.costPaise)} · life{' '}
                        {a.usefulLifeMonths} mo
                        {a.depreciationThrough ? ` · depreciated through ${a.depreciationThrough}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono text-sm tabular-nums">
                          {formatINR(a.bookValuePaise)}
                        </div>
                        <div className="text-muted-foreground text-[11px]">
                          book · −{formatINR(a.accumulatedDepreciationPaise)} dep
                        </div>
                      </div>
                      {canManage && a.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void disposeFixedAsset(a.id).then((r) => {
                              if (r.ok) {
                                toast.success('Asset marked disposed.');
                                reload();
                              } else toast.error(r.message);
                            });
                          }}
                        >
                          Dispose
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <>
          <AddAssetDialog open={addOpen} onOpenChange={setAddOpen} onSaved={reload} />
          <RunDepreciationDialog open={depOpen} onOpenChange={setDepOpen} onDone={reload} />
        </>
      ) : null}
    </>
  );
}

function AddAssetDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [acquired, setAcquired] = useState(todayISO());
  const [cost, setCost] = useState('');
  const [salvage, setSalvage] = useState('');
  const [life, setLife] = useState('36');
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setName('');
      setCategory('');
      setAcquired(todayISO());
      setCost('');
      setSalvage('');
      setLife('36');
      setNotes('');
    });
  }, [open]);

  function parse(s: string): bigint | null {
    const t = s.replace(/[,\s]/g, '').trim();
    if (t === '') return 0n;
    try {
      return rupeesToPaise(t);
    } catch {
      return null;
    }
  }

  function save() {
    const costPaise = parse(cost);
    const salvagePaise = parse(salvage);
    const months = Number(life || '0');
    if (name.trim() === '') return toast.error('Name the asset.');
    if (costPaise === null || costPaise <= 0n) return toast.error('Enter a valid cost.');
    if (salvagePaise === null) return toast.error('Enter a valid salvage value.');
    if (!Number.isInteger(months) || months < 1) return toast.error('Useful life must be ≥ 1 month.');
    startTransition(async () => {
      const res = await createFixedAsset({
        name: name.trim(),
        category: category.trim() || null,
        acquisitionDate: acquired,
        costPaise,
        salvageValuePaise: salvagePaise,
        usefulLifeMonths: months,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success('Asset added.');
      onOpenChange(false);
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add fixed asset</DialogTitle>
          <DialogDescription>
            Straight-line: monthly depreciation = (cost − salvage) / useful life.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="fa-name">Name</Label>
            <Input
              id="fa-name"
              placeholder="MacBook Pro 16”"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fa-cat">Category</Label>
              <Input
                id="fa-cat"
                placeholder="Computers"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fa-acq">Acquired</Label>
              <Input
                id="fa-acq"
                type="date"
                value={acquired}
                onChange={(e) => setAcquired(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fa-cost">Cost ₹</Label>
              <Input
                id="fa-cost"
                inputMode="decimal"
                placeholder="250000"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fa-salv">Salvage ₹</Label>
              <Input
                id="fa-salv"
                inputMode="decimal"
                placeholder="0"
                value={salvage}
                onChange={(e) => setSalvage(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fa-life">Life (months)</Label>
              <Input
                id="fa-life"
                inputMode="numeric"
                value={life}
                onChange={(e) => setLife(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fa-notes">Notes (optional)</Label>
            <Textarea id="fa-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Add asset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunDepreciationDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [through, setThrough] = useState(todayISO());
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await runDepreciation({ throughDate: through });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { totalPaise, assetsDepreciated } = res.data;
      if (assetsDepreciated === 0) toast.info('No depreciation due in this period.');
      else toast.success(`Posted ${formatINR(totalPaise)} depreciation across ${assetsDepreciated} asset(s).`);
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Run depreciation</DialogTitle>
          <DialogDescription>
            Charges straight-line depreciation for every active asset through the date below, and
            posts one journal (Dr Depreciation / Cr Accumulated Depreciation).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="dep-through">Depreciate through</Label>
          <Input
            id="dep-through"
            type="date"
            value={through}
            onChange={(e) => setThrough(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={run} disabled={pending}>
            {pending ? 'Posting…' : 'Run depreciation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
