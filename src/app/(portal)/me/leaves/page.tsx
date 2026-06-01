import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LeaveApplyForm } from './leave-apply-form';
import { LeaveHistory } from './leave-history';

export const metadata: Metadata = { title: 'My leaves · Apār self-service' };

const BALANCES = [
  { kind: 'Casual', balance: 6, used: 4 },
  { kind: 'Earned', balance: 12, used: 0 },
  { kind: 'Sick', balance: 7, used: 1 },
];

const HISTORY = [
  {
    id: 'lv-a',
    kind: 'Casual',
    from: '2026-05-05',
    to: '2026-05-06',
    days: 2,
    status: 'approved' as const,
    approvedBy: 'Riya Patel',
  },
  {
    id: 'lv-b',
    kind: 'Sick',
    from: '2026-04-19',
    to: '2026-04-19',
    days: 1,
    status: 'approved' as const,
    approvedBy: 'Riya Patel',
  },
];

export default function MeLeavesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My leaves</h1>
        <p className="text-muted-foreground text-sm">
          See your balance, apply, and check the status of past applications.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {BALANCES.map((b) => (
          <Card key={b.kind}>
            <CardContent className="py-4">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">{b.kind}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{b.balance} days</p>
              <p className="text-muted-foreground mt-1 text-xs">{b.used} used this year</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Apply for leave</CardTitle>
          </CardHeader>
          <CardContent>
            <LeaveApplyForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <LeaveHistory rows={HISTORY} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
