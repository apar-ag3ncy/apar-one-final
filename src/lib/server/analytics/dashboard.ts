'use server';

// Company-metrics Dashboard aggregation. One entry point, `getDashboardMetrics`,
// computes every tile + chart for "this month" and "this financial year"
// (India FY = 1 Apr). All money aggregation is Postgres-side (CLAUDE rule #17)
// and every paise value is returned as a `string` (bigint → String) so the
// server-action payload serializes safely across the RSC boundary. Every
// export stays async — sync exports break the Vercel build.

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { fiscalYear, fiscalYearStart } from '@/lib/date';
import { getCashFlowStatement } from '@/lib/server/ledger/report-suite';
import { getPerClientPnL } from '@/lib/server/ledger/reports';
import { getOfficeExpenseSummary } from '@/lib/server/entities/office-expenses';
import { listClients } from '@/lib/server-stub/entity-actions';
import { getActorContext } from '@/lib/server/actor';
import { getRevenueTargets } from '@/lib/server/settings/revenue-targets';

export type DashboardMetrics = {
  fyLabel: string;
  revenueMonthPaise: string;
  revenueFyPaise: string;
  targetMonthlyPaise: string | null;
  targetAnnualPaise: string | null;
  cashReceivedFyPaise: string;
  activeProjects: number;
  totalProjects: number;
  headcount: number;
  newRecruitsThisMonth: number;
  newRecruitsByType: { type: string; count: number }[];
  avgSalaryMonthlyPaise: string | null;
  /** Average team members per employee across live projects, to 1 decimal. */
  avgProjectsPerEmployee: number;
  /** Last 12 months incl. gaps rendered as '0' so the trend line is continuous. */
  revenueTrend: { month: string; paise: string }[];
  industryContribution: { industry: string; paise: string }[];
  /** Top 6 clients by gross margin (accrual). */
  topClients: { clientName: string; revenuePaise: string; grossMarginPaise: string }[];
  officeSpendByCategory: { category: string; paise: string }[];
  /** Top 8 vendors by office spend (amount + GST) this FY. */
  officeSpendByVendor: { vendor: string; paise: string }[];
  salaryByDepartment: { department: string; paise: string }[];
  salaryByGrade: { grade: string; paise: string }[];
  /** Top 12 employees by total salary paid (§2.1a). */
  salaryByEmployee: { employee: string; paise: string }[];
  /** Projects grouped into pipeline stages — a point-in-time snapshot (§2.2.6). */
  pitchFunnel: { stage: string; count: number }[];
  /** Average completed-project turnover in days (start → completed), or null (§2.2.8). */
  avgTurnoverDays: number | null;
  /** Recent completed projects with their start→completed duration in days (§2.2.8). */
  projectTurnover: { code: string; name: string; days: number }[];
};

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * Σ revenue (4100 Fees + 4200 Other Income, credit legs of posted, non-reversed
 * transactions) over an inclusive date range. Returns bigint-as-string.
 */
async function sumRevenuePaise(from: string, to: string): Promise<string> {
  const rows = await db.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(p.amount_paise), 0)::text AS total
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE a.code IN ('4100', '4200') AND p.side = 'credit'
      AND t.status = 'posted' AND t.reverses_id IS NULL
      AND t.txn_date >= ${from}::date AND t.txn_date <= ${to}::date
  `);
  return rowsOf<{ total: string }>(rows)[0]?.total ?? '0';
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  await getActorContext();

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fy = fiscalYear(now);
  const fyStart = fiscalYearStart(fy).toISOString().slice(0, 10);
  // "FY 2026-27" — fy=2027 means the 1 Apr 2026 → 31 Mar 2027 period.
  const fyLabel = `FY ${fy - 1}-${String(fy).slice(2)}`;
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  // First day of the month 11 months ago — start of the 12-month trend window.
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
    .toISOString()
    .slice(0, 10);

  const [revenueMonthPaise, revenueFyPaise, targets, cashFlow, officeSummary, pnl, clientsList] =
    await Promise.all([
      sumRevenuePaise(monthStart, today),
      sumRevenuePaise(fyStart, today),
      getRevenueTargets(),
      getCashFlowStatement({ from: fyStart, to: today }),
      getOfficeExpenseSummary(),
      getPerClientPnL({ from: fyStart, to: today }),
      listClients(),
    ]);

  const cashReceivedFyPaise = (
    cashFlow.rows.find((r) => r.kind === 'client_payment_received')?.inflowPaise ?? 0n
  ).toString();

  // Projects — active = live board card; total = every non-deleted project.
  const projectRows = await db.execute<{ active: string; total: string }>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'active' AND is_archived = false THEN 1 ELSE 0 END), 0)::text AS active,
      COUNT(*)::text AS total
    FROM projects
    WHERE deleted_at IS NULL
  `);
  const projectAgg = rowsOf<{ active: string; total: string }>(projectRows)[0];
  const activeProjects = Number(projectAgg?.active ?? '0');
  const totalProjects = Number(projectAgg?.total ?? '0');

  // Employees — headcount (active, on-roll) + new recruits this month.
  const empRows = await db.execute<{ headcount: string; recruits: string }>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN is_archived = false AND status = 'active' THEN 1 ELSE 0 END), 0)::text AS headcount,
      COALESCE(SUM(CASE WHEN joined_on >= ${monthStart}::date AND joined_on <= ${today}::date THEN 1 ELSE 0 END), 0)::text AS recruits
    FROM employees
    WHERE deleted_at IS NULL
  `);
  const empAgg = rowsOf<{ headcount: string; recruits: string }>(empRows)[0];
  const headcount = Number(empAgg?.headcount ?? '0');
  const newRecruitsThisMonth = Number(empAgg?.recruits ?? '0');

  const recruitTypeRows = await db.execute<{ type: string; count: string }>(sql`
    SELECT employment_type::text AS type, COUNT(*)::text AS count
    FROM employees
    WHERE deleted_at IS NULL
      AND joined_on >= ${monthStart}::date AND joined_on <= ${today}::date
    GROUP BY employment_type
    ORDER BY COUNT(*) DESC
  `);
  const newRecruitsByType = rowsOf<{ type: string; count: string }>(recruitTypeRows).map((r) => ({
    type: r.type,
    count: Number(r.count),
  }));

  // Average current monthly CTC across active employees.
  // NOTE: reading salary is normally gated by `view_salary`. The whole
  // Dashboard app is admin-gated (app.dashboard.view), so we compute the
  // company-wide average here with the service db and no per-row salary gate.
  const salaryAvgRows = await db.execute<{ avg: string | null }>(sql`
    SELECT AVG(cur.ctc_monthly_paise)::bigint::text AS avg
    FROM employees e
    JOIN LATERAL (
      SELECT ss.ctc_monthly_paise
      FROM salary_structures ss
      WHERE ss.employee_id = e.id
        AND ss.effective_from <= ${today}::date
        AND (ss.effective_to IS NULL OR ss.effective_to >= ${today}::date)
      ORDER BY ss.effective_from DESC
      LIMIT 1
    ) cur ON true
    WHERE e.deleted_at IS NULL AND e.is_archived = false AND e.status = 'active'
  `);
  const avgSalaryMonthlyPaise = rowsOf<{ avg: string | null }>(salaryAvgRows)[0]?.avg ?? null;

  // Average team members per employee across live (active, on-roll) projects.
  const memberRows = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt
    FROM project_members pm
    JOIN projects pr ON pr.id = pm.project_id
    WHERE pr.deleted_at IS NULL AND pr.is_archived = false AND pr.status = 'active'
  `);
  const memberCount = Number(rowsOf<{ cnt: string }>(memberRows)[0]?.cnt ?? '0');
  const avgProjectsPerEmployee =
    headcount > 0 ? Math.round((memberCount / headcount) * 10) / 10 : 0;

  // Revenue trend — monthly revenue over the last 12 months, gaps filled '0'.
  const trendRows = await db.execute<{ month: string; total: string }>(sql`
    SELECT to_char(date_trunc('month', t.txn_date), 'YYYY-MM') AS month,
      COALESCE(SUM(p.amount_paise), 0)::text AS total
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE a.code IN ('4100', '4200') AND p.side = 'credit'
      AND t.status = 'posted' AND t.reverses_id IS NULL
      AND t.txn_date >= ${trendStart}::date AND t.txn_date <= ${today}::date
    GROUP BY 1
    ORDER BY 1
  `);
  const trendMap = new Map(
    rowsOf<{ month: string; total: string }>(trendRows).map((r) => [r.month, r.total]),
  );
  const revenueTrend: { month: string; paise: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    revenueTrend.push({ month: key, paise: trendMap.get(key) ?? '0' });
  }

  // Industry contribution — per-client FY revenue aggregated up to the client's
  // industry (null / '' → 'Unspecified'), positive contributors only.
  const industryByClientId = new Map(
    clientsList.map((c) => [c.id, c.industry.trim() || 'Unspecified'] as const),
  );
  const industryAgg = new Map<string, bigint>();
  for (const row of pnl) {
    const industry = industryByClientId.get(row.clientId) ?? 'Unspecified';
    industryAgg.set(industry, (industryAgg.get(industry) ?? 0n) + row.revenuePaise);
  }
  const industryContribution = [...industryAgg.entries()]
    .filter(([, paise]) => paise > 0n)
    .map(([industry, paise]) => ({ industry, paise: paise.toString() }))
    .sort((a, b) => cmpDescStr(a.paise, b.paise));

  // Most profitable clients — top 6 by accrual gross margin.
  const topClients = [...pnl]
    .sort((a, b) =>
      b.grossMarginPaise > a.grossMarginPaise
        ? 1
        : b.grossMarginPaise < a.grossMarginPaise
          ? -1
          : 0,
    )
    .slice(0, 6)
    .map((r) => ({
      clientName: r.clientName,
      revenuePaise: r.revenuePaise.toString(),
      grossMarginPaise: r.grossMarginPaise.toString(),
    }));

  // Office spend by category (FY-to-date; already computed by the Office app).
  const officeSpendByCategory = officeSummary.byCategory
    .map((c) => ({ category: String(c.category), paise: c.totalPaise.toString() }))
    .filter((c) => c.paise !== '0')
    .sort((a, b) => cmpDescStr(a.paise, b.paise));

  // Office spend by vendor (directory name, else free-text) — top 8 this FY.
  const vendorRows = await db.execute<{ vendor: string; total: string }>(sql`
    SELECT COALESCE(v.name, oe.vendor_name, 'Unspecified') AS vendor,
      COALESCE(SUM(oe.amount_paise + oe.gst_paise), 0)::text AS total
    FROM office_expenses oe
    LEFT JOIN vendors v ON v.id = oe.vendor_id
    WHERE oe.deleted_at IS NULL
      AND oe.expense_date >= ${fyStart}::date AND oe.expense_date <= ${today}::date
    GROUP BY COALESCE(v.name, oe.vendor_name, 'Unspecified')
    ORDER BY SUM(oe.amount_paise + oe.gst_paise) DESC
    LIMIT 8
  `);
  const officeSpendByVendor = rowsOf<{ vendor: string; total: string }>(vendorRows).map((r) => ({
    vendor: r.vendor,
    paise: r.total,
  }));

  // Salary by department / payroll grade — from captured salary_payments.
  // NOTE: some historical salary lives in office_expenses (uncategorised
  // payouts), which this v1 does NOT fold in — the split here reflects
  // salary_payments only. Acceptable for the first cut.
  const deptRows = await db.execute<{ label: string; total: string }>(sql`
    SELECT COALESCE(NULLIF(TRIM(e.department), ''), 'Unassigned') AS label,
      COALESCE(SUM(sp.amount_paise), 0)::text AS total
    FROM salary_payments sp
    JOIN employees e ON e.id = sp.employee_id
    WHERE sp.deleted_at IS NULL
    GROUP BY COALESCE(NULLIF(TRIM(e.department), ''), 'Unassigned')
    ORDER BY SUM(sp.amount_paise) DESC
  `);
  const salaryByDepartment = rowsOf<{ label: string; total: string }>(deptRows).map((r) => ({
    department: r.label,
    paise: r.total,
  }));

  const gradeRows = await db.execute<{ label: string; total: string }>(sql`
    SELECT COALESCE(NULLIF(TRIM(e.payroll_grade), ''), 'Unassigned') AS label,
      COALESCE(SUM(sp.amount_paise), 0)::text AS total
    FROM salary_payments sp
    JOIN employees e ON e.id = sp.employee_id
    WHERE sp.deleted_at IS NULL
    GROUP BY COALESCE(NULLIF(TRIM(e.payroll_grade), ''), 'Unassigned')
    ORDER BY SUM(sp.amount_paise) DESC
  `);
  const salaryByGrade = rowsOf<{ label: string; total: string }>(gradeRows).map((r) => ({
    grade: r.label,
    paise: r.total,
  }));

  // Employee-wise total salary paid — top 12 (the full list lives in the Salary
  // Book). Same salary_payments source as the dept/grade splits (§2.1a).
  const empSalaryRows = await db.execute<{ name: string; total: string }>(sql`
    SELECT e.full_name AS name, COALESCE(SUM(sp.amount_paise), 0)::text AS total
    FROM salary_payments sp
    JOIN employees e ON e.id = sp.employee_id
    WHERE sp.deleted_at IS NULL
    GROUP BY e.id, e.full_name
    ORDER BY SUM(sp.amount_paise) DESC
    LIMIT 12
  `);
  const salaryByEmployee = rowsOf<{ name: string; total: string }>(empSalaryRows).map((r) => ({
    employee: r.name,
    paise: r.total,
  }));

  // Pipeline funnel — a point-in-time snapshot of where projects currently sit
  // (project status IS the funnel: pitch → won → active/on_hold → completed),
  // plus cancelled as drop-off. NOT a cohort conversion rate (§2.2.6).
  const statusRows = await db.execute<{ status: string; count: string }>(sql`
    SELECT status::text AS status, COUNT(*)::text AS count
    FROM projects
    WHERE deleted_at IS NULL
    GROUP BY status
  `);
  const statusCount = new Map<string, number>();
  for (const r of rowsOf<{ status: string; count: string }>(statusRows)) {
    statusCount.set(r.status, Number(r.count));
  }
  const pitchFunnel = [
    { stage: 'Pitch', count: statusCount.get('pitch') ?? 0 },
    { stage: 'Won', count: statusCount.get('won') ?? 0 },
    {
      stage: 'In progress',
      count: (statusCount.get('active') ?? 0) + (statusCount.get('on_hold') ?? 0),
    },
    { stage: 'Completed', count: statusCount.get('completed') ?? 0 },
    { stage: 'Cancelled', count: statusCount.get('cancelled') ?? 0 },
  ];

  // Avg project turnover — days from started_on to completed_on over completed
  // projects (completed_on backfilled in 0077). date − date = integer days (§2.2.8).
  const turnoverAvgRows = await db.execute<{ avg: string | null }>(sql`
    SELECT AVG(completed_on - started_on)::numeric(10,1)::text AS avg
    FROM projects
    WHERE status = 'completed' AND deleted_at IS NULL
      AND completed_on IS NOT NULL AND started_on IS NOT NULL
      AND completed_on >= started_on
  `);
  const avgTurnoverRaw = rowsOf<{ avg: string | null }>(turnoverAvgRows)[0]?.avg ?? null;
  const avgTurnoverDays = avgTurnoverRaw !== null ? Number(avgTurnoverRaw) : null;

  const turnoverRows = await db.execute<{ code: string | null; name: string; days: string }>(sql`
    SELECT code, name, (completed_on - started_on)::text AS days
    FROM projects
    WHERE status = 'completed' AND deleted_at IS NULL
      AND completed_on IS NOT NULL AND started_on IS NOT NULL
      AND completed_on >= started_on
    ORDER BY completed_on DESC
    LIMIT 8
  `);
  const projectTurnover = rowsOf<{ code: string | null; name: string; days: string }>(
    turnoverRows,
  ).map((r) => ({ code: r.code ?? '—', name: r.name, days: Number(r.days) }));

  return {
    fyLabel,
    revenueMonthPaise,
    revenueFyPaise,
    targetMonthlyPaise: targets.monthlyPaise,
    targetAnnualPaise: targets.annualPaise,
    cashReceivedFyPaise,
    activeProjects,
    totalProjects,
    headcount,
    newRecruitsThisMonth,
    newRecruitsByType,
    avgSalaryMonthlyPaise,
    avgProjectsPerEmployee,
    revenueTrend,
    industryContribution,
    topClients,
    officeSpendByCategory,
    officeSpendByVendor,
    salaryByDepartment,
    salaryByGrade,
    salaryByEmployee,
    pitchFunnel,
    avgTurnoverDays,
    projectTurnover,
  };
}

/** Sort comparator: descending by bigint-as-string paise value. */
function cmpDescStr(a: string, b: string): number {
  const av = BigInt(a);
  const bv = BigInt(b);
  return bv > av ? 1 : bv < av ? -1 : 0;
}
