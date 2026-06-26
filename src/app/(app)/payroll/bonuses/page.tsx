import type { Metadata } from 'next';
import { Card, CardContent } from '@/components/ui/card';
import { ProfileHeader } from '@/components/entity/profile-header';
import { BonusForm } from './bonus-form';
import { listEmployees } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = { title: 'Bonuses · Apar Dashboard' };

export default async function BonusesPage() {
  const employees = await listEmployees();
  return (
    <>
      <ProfileHeader
        title="Bonuses & perks"
        subtitle="Quarterly bonuses, festival perks, retention awards. Captured once, paid via the next salary run or as a separate payment."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <BonusForm employees={employees.map((e) => ({ id: e.id, fullName: e.fullName }))} />
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Recent bonuses load here once Backend ships `getBonuses` / `getPerks`.
          </CardContent>
        </Card>
      </div>
    </>
  );
}
