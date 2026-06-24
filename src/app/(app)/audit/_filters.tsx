'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ENTITY_TYPES = [
  'all',
  'client',
  'vendor',
  'employee',
  'project',
  'transaction',
  'period',
  'document',
  'invoice',
  'bill',
  'receipt',
  'vault',
  'vault_item',
] as const;

export function AuditFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [entityType, setEntityType] = useState(params.get('entityType') ?? 'all');
  const [entityId, setEntityId] = useState(params.get('entityId') ?? '');
  const [fromDate, setFromDate] = useState(params.get('fromDate') ?? '');
  const [toDate, setToDate] = useState(params.get('toDate') ?? '');
  const [stream, setStream] = useState((params.get('stream') ?? 'audit') as 'audit' | 'activity');

  function apply() {
    const next = new URLSearchParams();
    if (entityType !== 'all') next.set('entityType', entityType);
    if (entityId) next.set('entityId', entityId);
    if (fromDate) next.set('fromDate', fromDate);
    if (toDate) next.set('toDate', toDate);
    if (stream !== 'audit') next.set('stream', stream);
    router.push(`/audit?${next.toString()}`);
  }

  function reset() {
    setEntityType('all');
    setEntityId('');
    setFromDate('');
    setToDate('');
    setStream('audit');
    router.push('/audit');
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="lg:col-span-1">
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">Stream</Label>
        <Select value={stream} onValueChange={(v) => setStream(v as 'audit' | 'activity')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="audit">Diff trail (audit_log)</SelectItem>
            <SelectItem value="activity">Activity feed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="lg:col-span-1">
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">Entity type</Label>
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t === 'all' ? 'All entities' : t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="lg:col-span-2">
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">Entity id</Label>
        <Input
          placeholder="UUID (optional)"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
        />
      </div>
      <div>
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">From</Label>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
      </div>
      <div>
        <Label className="text-muted-foreground text-xs tracking-wide uppercase">To</Label>
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </div>
      <div className="flex items-end gap-2 lg:col-span-6">
        <Button onClick={apply}>Apply</Button>
        <Button variant="outline" onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
