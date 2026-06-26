import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AwardIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FolderKanbanIcon,
  ReceiptIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';

export const metadata: Metadata = { title: 'Apar self-service · Home' };

// TODO(backend): replace with the logged-in employee + their KPIs.
const ME = {
  fullName: 'Anjali Mehta',
  designation: 'Senior Designer',
  joinedAt: '2024-04-01',
  leaveBalance: { casual: 6, earned: 12, sick: 7 },
  reimbursementsPendingPaise: 4_250_00n,
  earningsYtdPaise: 5_85_000_00n,
  attendancePctMtd: 95,
};

const ACHIEVEMENTS = [
  { at: '2026-04', title: 'Q4 performance bonus', tone: 'success' as const },
  { at: '2025-12', title: '1-year completion award', tone: 'accent' as const },
  { at: '2025-10', title: 'Spot award — Marigold launch', tone: 'info' as const },
];

const PROJECTS = [
  { code: 'PRJ-26-014', name: 'Marigold spring campaign', role: 'Lead' },
  { code: 'PRJ-26-019', name: 'Atlas brand refresh', role: 'Designer' },
];

export default function MeHomePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hello, {ME.fullName.split(' ')[0]}
        </h1>
        <p className="text-muted-foreground text-sm">
          {ME.designation} · Joined {ME.joinedAt}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Attendance MTD"
          value={`${ME.attendancePctMtd}%`}
          icon={CheckCircle2Icon}
          href="#"
        />
        <Kpi
          label="Leave balance"
          value={`${ME.leaveBalance.casual + ME.leaveBalance.earned + ME.leaveBalance.sick} days`}
          icon={CalendarDaysIcon}
          href="/me/leaves"
        />
        <Kpi
          label="Pending reimbursements"
          value={formatINR(ME.reimbursementsPendingPaise)}
          icon={ReceiptIcon}
          href="/me/reimbursements"
        />
        <Kpi
          label="Earnings YTD"
          value={formatINR(ME.earningsYtdPaise)}
          icon={AwardIcon}
          href="/me/payslips"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My achievements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {ACHIEVEMENTS.map((a) => (
              <div
                key={a.at}
                className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0"
              >
                <span>{a.title}</span>
                <StatusBadge tone={a.tone} label={a.at} dot={false} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projects I&apos;m on</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {PROJECTS.map((p) => (
                <li key={p.code} className="flex items-center justify-between">
                  <span>
                    <span className="font-mono text-xs opacity-70">{p.code}</span> {p.name}
                  </span>
                  <StatusBadge tone="neutral" label={p.role} dot={false} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline">
              <Link href="/me/leaves">Apply for leave</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/me/reimbursements">Submit reimbursement</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/me/payslips">Download payslip</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/me/documents">My documents</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ActivityRow
              icon={ReceiptIcon}
              text="Reimbursement of ₹4,250 submitted · awaiting approval"
              when="2 days ago"
            />
            <ActivityRow
              icon={CalendarDaysIcon}
              text="2-day casual leave approved by Riya Patel"
              when="last week"
            />
            <ActivityRow
              icon={FileTextIcon}
              text="Q1 appraisal document published"
              when="3 weeks ago"
            />
            <ActivityRow
              icon={FolderKanbanIcon}
              text="Added to PRJ-26-019 Atlas brand refresh"
              when="last month"
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  icon: typeof CalendarDaysIcon;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover:bg-muted/40 transition-colors">
        <CardContent className="flex items-center gap-3 py-4">
          <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-md">
            <Icon className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
            <p className="font-mono text-lg font-semibold tabular-nums">{value}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ActivityRow({
  icon: Icon,
  text,
  when,
}: {
  icon: typeof CalendarDaysIcon;
  text: string;
  when: string;
}) {
  return (
    <div className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0">
      <span className="inline-flex items-center gap-2">
        <Icon className="text-muted-foreground size-3.5" aria-hidden />
        {text}
      </span>
      <span className="text-muted-foreground text-xs">{when}</span>
    </div>
  );
}
