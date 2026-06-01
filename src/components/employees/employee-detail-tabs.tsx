'use client';

import {
  AwardIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  LaptopIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { UrlTabs, type UrlTab } from '@/components/shared/url-tabs';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { DocumentList } from '@/components/entity/document-list';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import type { Department, Employee, EmploymentType } from './types';

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractor: 'Contractor',
  intern: 'Intern',
};

const DEPARTMENT_LABELS: Record<Department, string> = {
  creative: 'Creative',
  strategy: 'Strategy',
  growth: 'Growth',
  operations: 'Operations',
  finance: 'Finance',
  engineering: 'Engineering',
  leadership: 'Leadership',
};

export function EmployeeDetailTabs({ employee }: { employee: Employee }) {
  const tabs: UrlTab[] = [
    { value: 'profile', label: 'Profile' },
    { value: 'documents', label: 'Documents', count: employee.documentsCount },
    { value: 'reporting', label: 'Reporting' },
    { value: 'leaves', label: 'Leaves' },
    { value: 'attendance', label: 'Attendance' },
    { value: 'assets', label: 'Assets' },
    { value: 'performance', label: 'Performance' },
    { value: 'activity', label: 'Activity' },
  ];
  return (
    <UrlTabs tabs={tabs} defaultTab="profile">
      {{
        profile: <ProfileTab employee={employee} />,
        documents: <DocumentsTab employee={employee} />,
        reporting: <ReportingTab employee={employee} />,
        leaves: <LeavesTab />,
        attendance: <AttendanceTab />,
        assets: <AssetsTab />,
        performance: <PerformanceTab />,
        activity: <ActivityTab />,
      }}
    </UrlTabs>
  );
}

function ProfileTab({ employee }: { employee: Employee }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Identity & employment</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Detail label="Designation" value={employee.designation} />
            <Detail label="Department" value={DEPARTMENT_LABELS[employee.department]} />
            <Detail label="Type" value={EMPLOYMENT_LABELS[employee.employmentType]} />
            <Detail
              label="Reports to"
              value={
                employee.reportsTo ?? <span className="text-muted-foreground">No manager</span>
              }
            />
            <Detail
              label="Joined"
              value={employee.joinedAt.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            />
            <Detail
              label="Exit"
              value={
                employee.exitedAt ? (
                  employee.exitedAt.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
            <Detail label="Work email" value={employee.workEmail} />
            <Detail label="Phone" value={<span className="tabular-nums">{employee.phone}</span>} />
            <Detail label="City" value={employee.city} />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">KYC (masked)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Detail
            label="PAN"
            value={
              employee.panMasked ? (
                <span className="font-mono">{employee.panMasked}</span>
              ) : (
                <span className="text-muted-foreground">Not on file</span>
              )
            }
          />
          <Detail
            label="Aadhaar"
            value={
              employee.aadhaarMasked ? (
                <span className="font-mono">{employee.aadhaarMasked}</span>
              ) : (
                <span className="text-muted-foreground">Not on file</span>
              )
            }
          />
          <StatusBadge
            tone="warning"
            label="Full KYC requires HR + signed URL"
            dot={false}
            className="mt-2"
          />
          {employee.notes ? (
            <p className="text-muted-foreground mt-3 text-sm whitespace-pre-wrap">
              {employee.notes}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentsTab({ employee }: { employee: Employee }) {
  return <DocumentList documents={[]} entityName={employee.fullName} />;
}

function ReportingTab({ employee }: { employee: Employee }) {
  return (
    <EmptyState
      icon={UsersRoundIcon}
      title="Reporting tree not wired yet"
      description={
        employee.reportsTo
          ? `${employee.fullName} reports to ${employee.reportsTo}. Reports/direct-reports tree renders once Backend ships the recursive query.`
          : `${employee.fullName} has no manager set. Reports tree renders once Backend ships the recursive query.`
      }
    />
  );
}

function LeavesTab() {
  return (
    <EmptyState
      icon={CalendarDaysIcon}
      title="Leaves not wired yet"
      description="Leave balances and applications render once Backend ships P2.05."
    />
  );
}

function AttendanceTab() {
  return (
    <EmptyState
      icon={ClipboardCheckIcon}
      title="Attendance not wired yet"
      description="Monthly attendance grid + CSV import land in Phase 2 (P2.06)."
    />
  );
}

function AssetsTab() {
  return (
    <EmptyState
      icon={LaptopIcon}
      title="Assets not wired yet"
      description="Assigned laptops, phones, SIMs render here once Backend ships P2.07."
    />
  );
}

function PerformanceTab() {
  return (
    <EmptyState
      icon={AwardIcon}
      title="Performance not wired yet"
      description="KPI scores and quarterly reviews land in Phase 2 (P2.08). Warnings + testimonials follow in P2.09."
      action={
        <StatusBadge
          tone="info"
          label="P2.09 surfaces warnings + testimonials here too"
          dot={false}
        />
      }
    />
  );
}

function ActivityTab() {
  const onNavigate = useEntityNavigate();
  return <ActivityFeed events={[]} onNavigate={onNavigate} showHeader={false} />;
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
