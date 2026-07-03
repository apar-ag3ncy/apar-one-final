import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Building2Icon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  KeyRoundIcon,
  LandmarkIcon,
  type LucideIcon,
  PercentIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TextCursorInputIcon,
} from 'lucide-react';

import { ProfileHeader } from '@/components/entity/profile-header';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Settings · Apar Dashboard' };

type SettingsLink = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

const SECTIONS: readonly SettingsLink[] = [
  {
    href: '/settings/company',
    title: 'Company details',
    description: 'Legal profile, GST/TAN/PAN/Udyam, addresses, and documents.',
    icon: Building2Icon,
  },
  {
    href: '/settings/billing',
    title: 'Billing · Bank accounts',
    description: 'Apar’s own bank accounts, with a primary and secondary.',
    icon: LandmarkIcon,
  },
  {
    href: '/settings/vault',
    title: 'Vault',
    description: 'Account IDs & passwords, encrypted behind a vault password.',
    icon: KeyRoundIcon,
  },
  {
    href: '/settings/periods',
    title: 'Accounting periods',
    description: 'Open, soft-close, hard-close, and re-open periods.',
    icon: CalendarRangeIcon,
  },
  {
    href: '/settings/holidays',
    title: 'Holidays',
    description: 'Company holiday calendar — payroll excludes these from working days.',
    icon: CalendarDaysIcon,
  },
  {
    href: '/settings/roles',
    title: 'Roles & permissions',
    description: 'What each role can do across the workspace.',
    icon: ShieldCheckIcon,
  },
  {
    href: '/settings/tax-rates',
    title: 'Tax reference rates',
    description: 'Captured GST/TDS rates used to label fields.',
    icon: PercentIcon,
  },
  {
    href: '/settings/forms',
    title: 'Form templates',
    description: 'Custom fields and layouts for entity forms.',
    icon: TextCursorInputIcon,
  },
  {
    href: '/settings/validation-rules',
    title: 'Validation rules',
    description: 'Guardrails applied across documents and postings.',
    icon: SlidersHorizontalIcon,
  },
];

export default function SettingsIndexPage() {
  return (
    <>
      <ProfileHeader
        title="Settings"
        subtitle="Configure Apar’s company profile, billing, and workspace rules."
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href} className="group">
              <Card className="hover:border-primary/40 h-full transition-colors">
                <CardContent className="flex items-start gap-3 py-5">
                  <span className="bg-muted text-muted-foreground group-hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium">{s.title}</div>
                    <p className="text-muted-foreground text-sm">{s.description}</p>
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
