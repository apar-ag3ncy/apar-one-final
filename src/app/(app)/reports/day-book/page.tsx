import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { getDayBook } from '@/lib/server/ledger/statements';
import { DayBookClient } from './day-book-client';

export const metadata: Metadata = { title: 'Day book · Apar Dashboard' };

export default async function DayBookPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from ?? `${new Date().getFullYear()}-04-01`;
  const to = sp.to ?? today;
  const entries = await getDayBook({ from, to });
  return (
    <>
      <ProfileHeader
        title="Day book"
        subtitle="Every posting in the period, oldest first — the chronological journal across all accounts."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <DayBookClient from={from} to={to} entries={entries} />
    </>
  );
}
