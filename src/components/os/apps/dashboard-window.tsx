'use client';

// Company-metrics Dashboard — native OS window. Loads getDashboardMetrics()
// on mount (skeleton while loading, error state), then renders a KPI tile row,
// a grid of money charts (trend / industry / clients / office spend / salary),
// two "coming soon" placeholders, and an admin-only "Edit targets" dialog that
// writes the two global revenue targets. OS-native chrome (inline styles + CSS
// vars) for the shell + tiles; shadcn ChartCard for the chart panels.

import { useState } from 'react';

import { ChartCard, MoneyBarChart, MoneyLineChart, MoneyPieChart } from '@/components/charts';
import { formatINR, formatPaiseForInput, parseRupeesToPaise } from '@/components/shared/format-inr';
import { useCurrentUser } from '@/lib/client/use-current-user';
import { osActions } from '@/lib/os/store';
import { getDashboardMetrics, type DashboardMetrics } from '@/lib/server/analytics/dashboard';
import { saveRevenueTargets } from '@/lib/server/settings/revenue-targets';

import { useReportData } from './report-window-kit';

/** Title-case a snake/enum label ("tea_coffee" → "Tea Coffee"). */
function pretty(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Short month label for the trend x-axis ("2026-07" → "Jul '26"). */
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const idx = Number(m) - 1;
  return `${names[idx] ?? m} '${(y ?? '').slice(2)}`;
}

export function DashboardWindow() {
  const { hasCapability } = useCurrentUser();
  const canEditTargets = hasCapability('manage_company_profile');

  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);

  const { data, error } = useReportData<DashboardMetrics>(() => getDashboardMetrics(), [reloadKey]);

  return (
    <div
      className="main"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 18, gap: 14 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            Dashboard
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Company metrics · {data?.fyLabel ?? 'this financial year'}
          </div>
        </div>
        {canEditTargets ? (
          <button
            type="button"
            className="btn"
            onClick={() => setEditing(true)}
            disabled={!data}
            title="Set the monthly and annual revenue targets"
          >
            Edit targets
          </button>
        ) : null}
      </header>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {error ? (
          <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
        ) : !data ? (
          <DashboardSkeleton />
        ) : (
          <DashboardBody metrics={data} />
        )}
      </div>

      {editing && data ? (
        <EditTargetsDialog
          metrics={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Body ──────────────────────────────────────────────────────────────── */

function DashboardBody({ metrics }: { metrics: DashboardMetrics }) {
  const trendData = metrics.revenueTrend.map((r) => ({
    month: monthLabel(r.month),
    paise: Number(r.paise),
  }));
  const industryData = metrics.industryContribution.map((r) => ({
    name: r.industry,
    paise: Number(r.paise),
  }));
  const clientData = metrics.topClients.map((c) => ({
    name: c.clientName,
    margin: Number(c.grossMarginPaise),
  }));
  const categoryData = metrics.officeSpendByCategory.map((c) => ({
    name: pretty(c.category),
    spend: Number(c.paise),
  }));
  const vendorData = metrics.officeSpendByVendor.map((v) => ({
    name: v.vendor,
    spend: Number(v.paise),
  }));
  const deptData = metrics.salaryByDepartment.map((d) => ({
    name: d.department,
    salary: Number(d.paise),
  }));
  const gradeData = metrics.salaryByGrade.map((g) => ({
    name: g.grade,
    salary: Number(g.paise),
  }));
  // The "Salary by employee" chart shows on-roster staff only (excludes
  // directors + inactive, which have their own directory sections), top 12.
  const empSalaryData = metrics.salaryEmployees
    .filter((e) => e.bucket === 'active')
    .slice(0, 12)
    .map((e) => ({ name: e.employee, salary: Number(e.paise) }));
  const funnelMax = Math.max(1, ...metrics.pitchFunnel.map((s) => s.count));
  const turnoverMax = Math.max(1, ...metrics.projectTurnover.map((p) => p.days));

  const recruitsSub =
    metrics.newRecruitsByType.length > 0
      ? metrics.newRecruitsByType.map((t) => `${t.count} ${pretty(t.type)}`).join(' · ')
      : 'No new joiners this month';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPI tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: 12,
        }}
      >
        <MetricTile
          label="Revenue · this month"
          value={formatINR(BigInt(metrics.revenueMonthPaise))}
          progress={progressOf(metrics.revenueMonthPaise, metrics.targetMonthlyPaise)}
        />
        <MetricTile
          label={`Revenue · ${metrics.fyLabel}`}
          value={formatINR(BigInt(metrics.revenueFyPaise))}
          progress={progressOf(metrics.revenueFyPaise, metrics.targetAnnualPaise)}
        />
        <MetricTile
          label="Cash received · FY"
          value={formatINR(BigInt(metrics.cashReceivedFyPaise))}
          tone="green"
        />
        <MetricTile
          label="Active projects"
          value={String(metrics.activeProjects)}
          sub={`${metrics.totalProjects} total`}
        />
        <MetricTile
          label="Team headcount"
          value={String(metrics.headcount)}
          sub={`+${metrics.newRecruitsThisMonth} this month · ${recruitsSub}`}
        />
        <MetricTile
          label="Avg salary / mo"
          value={
            metrics.avgSalaryMonthlyPaise ? formatINR(BigInt(metrics.avgSalaryMonthlyPaise)) : '—'
          }
        />
        <MetricTile
          label="Avg team / project"
          value={metrics.avgProjectsPerEmployee.toFixed(1)}
          sub="members per live project ÷ headcount"
        />
        <MetricTile
          label="Avg project turnover"
          value={metrics.avgTurnoverDays !== null ? `${metrics.avgTurnoverDays} days` : '—'}
          sub="start → completed"
        />
      </div>

      <SalaryDirectory metrics={metrics} />

      {/* Charts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 12,
        }}
      >
        <ChartCard
          title="Revenue trend"
          description="Billed revenue, last 12 months"
          empty={trendData.every((d) => d.paise === 0)}
        >
          <MoneyLineChart
            data={trendData}
            xKey="month"
            series={[{ dataKey: 'paise', name: 'Revenue' }]}
          />
        </ChartCard>

        <ChartCard
          title="Industry contribution"
          description={`Revenue by client industry · ${metrics.fyLabel}`}
          empty={industryData.length === 0}
        >
          <MoneyPieChart data={industryData} />
        </ChartCard>

        <ChartCard
          title="Most profitable clients"
          description="Top 6 by gross margin"
          empty={clientData.length === 0}
        >
          <MoneyBarChart
            data={clientData}
            xKey="name"
            series={[{ dataKey: 'margin', name: 'Gross margin' }]}
          />
        </ChartCard>

        <ChartCard
          title="Office spend by category"
          description={`This financial year`}
          empty={categoryData.length === 0}
        >
          <MoneyBarChart
            data={categoryData}
            xKey="name"
            series={[{ dataKey: 'spend', name: 'Spend' }]}
          />
        </ChartCard>

        <ChartCard
          title="Office spend by vendor"
          description="Top 8 vendors this FY"
          empty={vendorData.length === 0}
        >
          <MoneyBarChart
            data={vendorData}
            xKey="name"
            series={[{ dataKey: 'spend', name: 'Spend' }]}
          />
        </ChartCard>

        <ChartCard
          title="Salary by department"
          description="Disbursed salary payments"
          empty={deptData.length === 0}
        >
          <MoneyBarChart
            data={deptData}
            xKey="name"
            series={[{ dataKey: 'salary', name: 'Salary' }]}
          />
        </ChartCard>

        <ChartCard
          title="Salary by payroll grade"
          description="Disbursed salary payments"
          empty={gradeData.length === 0}
        >
          <MoneyBarChart
            data={gradeData}
            xKey="name"
            series={[{ dataKey: 'salary', name: 'Salary' }]}
          />
        </ChartCard>

        <ChartCard
          title="Salary by employee"
          description="Top 12 by disbursed salary"
          empty={empSalaryData.length === 0}
        >
          <MoneyBarChart
            data={empSalaryData}
            xKey="name"
            series={[{ dataKey: 'salary', name: 'Salary' }]}
          />
        </ChartCard>

        <ChartCard
          title="Projects by pipeline stage"
          description="Where projects currently sit (snapshot)"
          empty={metrics.pitchFunnel.every((s) => s.count === 0)}
          height={220}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px' }}>
            {metrics.pitchFunnel.map((s, i) => (
              <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 92, fontSize: 12, color: 'var(--text-muted)' }}>
                  {s.stage}
                </span>
                <div
                  style={{ flex: 1, height: 18, background: 'var(--content-2)', borderRadius: 4 }}
                >
                  <div
                    style={{
                      width: `${Math.max(2, (s.count / funnelMax) * 100)}%`,
                      height: '100%',
                      borderRadius: 4,
                      background: `var(--chart-${(i % 5) + 1}, #E63A1F)`,
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 28,
                    textAlign: 'right',
                    fontSize: 13,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Avg project turnover"
          description={
            metrics.avgTurnoverDays !== null
              ? `${metrics.avgTurnoverDays} days on average · recent completed`
              : 'Recent completed projects'
          }
          empty={metrics.projectTurnover.length === 0}
          emptyTitle="No completed projects yet"
          emptyDescription="Mark a project Completed to see its start→completed duration here."
          height={220}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px' }}>
            {metrics.projectTurnover.map((p) => (
              <div key={p.code + p.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 120,
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={p.name}
                >
                  {p.name}
                </span>
                <div
                  style={{ flex: 1, height: 18, background: 'var(--content-2)', borderRadius: 4 }}
                >
                  <div
                    style={{
                      width: `${Math.max(2, (p.days / turnoverMax) * 100)}%`,
                      height: '100%',
                      borderRadius: 4,
                      background: 'var(--chart-2, #2E8F5A)',
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 52,
                    textAlign: 'right',
                    fontSize: 12,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {p.days}d
                </span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

type SalaryDirTab = 'employees' | 'directors' | 'inactive' | 'months' | 'departments' | 'grades';

const SALARY_DIR_TABS: ReadonlyArray<[SalaryDirTab, string]> = [
  ['employees', 'Employees'],
  ['directors', 'Directors'],
  ['inactive', 'Inactive'],
  ['months', 'By month'],
  ['departments', 'Departments'],
  ['grades', 'Grades'],
];

/** 'YYYY-MM' → 'March 2026'. */
function monthLong(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/* ── Salary directory (§2.1b + salary sections) ────────────────────────────
   On-roster staff, directors and inactive people each get their own tab; a
   By-month tab totals salary across everyone per month. Each row expands to a
   share-of-payroll detail + "Open in Salary book" drill-in. */
function SalaryDirectory({ metrics }: { metrics: DashboardMetrics }) {
  const [tab, setTab] = useState<SalaryDirTab>('employees');
  const [selected, setSelected] = useState<string | null>(null);

  const empBucket = (b: 'active' | 'director' | 'inactive') =>
    metrics.salaryEmployees
      .filter((e) => e.bucket === b)
      .map((e) => ({ key: e.employee, label: e.employee, paise: e.paise }));

  const rows: { key: string; label: string; paise: string }[] =
    tab === 'employees'
      ? empBucket('active')
      : tab === 'directors'
        ? empBucket('director')
        : tab === 'inactive'
          ? empBucket('inactive')
          : tab === 'months'
            ? metrics.salaryByMonth.map((m) => ({
                key: m.month,
                label: monthLong(m.month),
                paise: m.paise,
              }))
            : tab === 'departments'
              ? metrics.salaryByDepartment.map((d) => ({
                  key: d.department,
                  label: d.department,
                  paise: d.paise,
                }))
              : metrics.salaryByGrade.map((g) => ({
                  key: g.grade,
                  label: g.grade,
                  paise: g.paise,
                }));

  const emptyMsg =
    tab === 'directors'
      ? 'No directors with salary yet. Set an employee’s designation to Director/Founder/Partner to list them here.'
      : tab === 'inactive'
        ? 'No inactive (separated / archived) employees with salary.'
        : 'No salary payments recorded yet.';

  const total = rows.reduce((sum, r) => sum + Number(r.paise), 0);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--content)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <span className="font-display" style={{ fontSize: 14, flex: 1, minWidth: 120 }}>
          Salary directory
        </span>
        <div
          role="tablist"
          style={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {SALARY_DIR_TABS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              onClick={() => {
                setTab(v);
                setSelected(null);
              }}
              className="btn"
              style={{
                border: 'none',
                borderRadius: 0,
                fontSize: 12,
                background: tab === v ? 'var(--apar-red, #E63A1F)' : 'transparent',
                color: tab === v ? '#fff' : 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16, margin: 0 }}>
          {emptyMsg}
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {rows.map((r) => {
            const share = total > 0 ? (Number(r.paise) / total) * 100 : 0;
            const open = selected === r.key;
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => setSelected(open ? null : r.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '7px 10px',
                    borderRadius: 8,
                    background: open ? 'var(--content-2)' : 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.label}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {formatINR(BigInt(r.paise))}
                  </span>
                </button>
                {open ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '4px 12px 8px',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span>{share.toFixed(1)}% of payroll shown here</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        osActions.openWindow({
                          app: 'ledger',
                          entityId: 'salary-book',
                          title: 'Salary book',
                          position: 'beside-focused',
                        })
                      }
                      style={{ fontSize: 12, padding: '3px 10px' }}
                    >
                      Open in Salary book →
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Percent of a target reached (0..∞), or null when no target is set. */
function progressOf(valuePaise: string, targetPaise: string | null): number | null {
  if (!targetPaise) return null;
  const target = Number(targetPaise);
  if (!(target > 0)) return null;
  return (Number(valuePaise) / target) * 100;
}

/* ── Tiles ─────────────────────────────────────────────────────────────── */

function MetricTile({
  label,
  value,
  sub,
  tone,
  progress,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'green';
  progress?: number | null;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '12px 14px',
        background: 'var(--surface, transparent)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        className="font-display"
        style={{
          fontSize: 22,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'green' ? 'var(--apar-green, #2E8F5A)' : 'var(--text)',
        }}
      >
        {value}
      </div>
      {progress !== undefined && progress !== null ? (
        <TargetBar pct={progress} />
      ) : sub ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
      ) : null}
    </div>
  );
}

function TargetBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const hit = pct >= 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            background: hit ? 'var(--apar-green, #2E8F5A)' : 'var(--apar-orange, #C46A28)',
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        {pct.toFixed(0)}% of target
      </div>
    </div>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: 12,
        }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonBox key={i} height={78} />
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 12,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBox key={i} height={320} />
        ))}
      </div>
    </div>
  );
}

function SkeletonBox({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'linear-gradient(90deg, var(--border) 0%, transparent 40%, var(--border) 80%)',
        opacity: 0.4,
      }}
    />
  );
}

/* ── Edit targets dialog ───────────────────────────────────────────────── */

function EditTargetsDialog({
  metrics,
  onClose,
  onSaved,
}: {
  metrics: DashboardMetrics;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [monthly, setMonthly] = useState(
    metrics.targetMonthlyPaise ? formatPaiseForInput(BigInt(metrics.targetMonthlyPaise)) : '',
  );
  const [annual, setAnnual] = useState(
    metrics.targetAnnualPaise ? formatPaiseForInput(BigInt(metrics.targetAnnualPaise)) : '',
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setErr(null);
    const monthlyPaise = parseRupeesToPaise(monthly || '0');
    const annualPaise = parseRupeesToPaise(annual || '0');
    if (monthlyPaise === null || annualPaise === null || monthlyPaise < 0n || annualPaise < 0n) {
      setErr('Enter valid, non-negative rupee amounts.');
      return;
    }
    setSaving(true);
    try {
      await saveRevenueTargets({
        monthlyPaise: monthlyPaise.toString(),
        annualPaise: annualPaise.toString(),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save targets.');
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit revenue targets"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          maxWidth: '90%',
          background: 'var(--panel, var(--background, #fff))',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        }}
      >
        <div className="font-display" style={{ fontSize: 16 }}>
          Revenue targets
        </div>
        <TargetInput label="Monthly target (₹)" value={monthly} onChange={setMonthly} />
        <TargetInput label="Annual target (₹)" value={annual} onChange={setAnnual} />
        {err ? <div style={{ fontSize: 12, color: 'var(--text-error, #c33)' }}>{err}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save targets'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TargetInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--input-bg, transparent)',
          color: 'var(--text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    </label>
  );
}
