import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRightIcon,
  AwardIcon,
  CalendarDaysIcon,
  CoinsIcon,
  ReceiptIcon,
  ScrollTextIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ProfileHeader } from '@/components/entity/profile-header';

export const metadata: Metadata = { title: 'Payroll · Apar Dashboard' };

const TILES = [
  {
    href: '/payroll/salary-structures',
    title: 'Salary structures',
    description: 'Per-employee earnings + deductions templates, versioned.',
    icon: ScrollTextIcon,
  },
  {
    href: '/payroll/salary-runs',
    title: 'Monthly salary runs',
    description: 'Generate, review, post the monthly payroll batch.',
    icon: CoinsIcon,
  },
  {
    href: '/payroll/bonuses',
    title: 'Bonuses & perks',
    description: 'Quarterly bonuses, festival perks, retention awards.',
    icon: AwardIcon,
  },
  {
    href: '/payroll/reimbursements',
    title: 'Reimbursement approvals',
    description: 'Queue of employee-submitted receipts pending sign-off.',
    icon: ReceiptIcon,
  },
  {
    href: '/payroll/leaves',
    title: 'Leave approvals',
    description: 'Manager-approval queue for leave applications.',
    icon: CalendarDaysIcon,
  },
];

export default function PayrollIndexPage() {
  return (
    <>
      <ProfileHeader title="Payroll" subtitle="Phase 4.5 — HRMS payroll module." />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link key={tile.href} href={tile.href}>
              <Card className="hover:bg-muted/40 hover:border-primary/40 transition-colors">
                <CardContent className="flex items-start gap-3 py-4">
                  <Icon className="size-5 opacity-70" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{tile.title}</p>
                      <ArrowRightIcon className="text-muted-foreground size-4" aria-hidden />
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">{tile.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
