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
      </div>

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
          title="Cold-pitch → conversion funnel"
          empty
          emptyTitle="Coming soon"
          emptyDescription="Pitch-to-win tracking isn't captured yet."
          height={220}
        >
          <div />
        </ChartCard>

        <ChartCard
          title="Avg project turnover time"
          empty
          emptyTitle="Coming soon"
          emptyDescription="Project start/close durations aren't tracked yet."
          height={220}
        >
          <div />
        </ChartCard>
      </div>
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
