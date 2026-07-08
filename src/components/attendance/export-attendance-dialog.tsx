'use client';

// Export attendance for a date range (day / week / month / year / custom),
// optionally scoped to selected employees. Produces a long-format sheet —
// one row per (employee, date) with the *effective* status (the implicit
// default filled in for any day without a stored override), so it round-trips
// through the import dialog. Rendered from the OS Attendance app header.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateField } from '@/components/shared/date-field';
import { defaultStatusForDate } from '@/lib/attendance-defaults';
import { exportRows, type ExportFormat } from '@/lib/client/export-rows';
import {
  getAttendanceForExport,
  listAttendanceEmployees,
  type AttendanceEmployeeOption,
  type AttendanceStatus,
} from '@/lib/server/entities/attendance';

import {
  STATUS_EXPORT_LABEL,
  aggregateAttendanceStats,
  computeAttendanceStats,
  eachIsoDate,
  splitIntoMonths,
  weekdayShort,
} from './attendance-io';
import type { AttendanceCalendarData, CalendarMonth, CalendarRow } from './attendance-io';
import type { AttendanceReportData, AttendanceReportRow } from './attendance-report-pdf';

type Preset = 'today' | 'week' | 'month' | 'year' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'custom', label: 'Custom' },
];

// Guard against an accidental decade-long range freezing the browser while it
// expands every (employee, date) cell.
const MAX_DAYS = 1500;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  if (preset === 'today') {
    const t = isoLocal(now);
    return { from: t, to: t };
  }
  if (preset === 'week') {
    const dow = (now.getDay() + 6) % 7; // 0 = Monday
    const mon = new Date(now);
    mon.setDate(now.getDate() - dow);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: isoLocal(mon), to: isoLocal(sun) };
  }
  if (preset === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: isoLocal(first), to: isoLocal(last) };
  }
  return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
}

export function ExportAttendanceDialog() {
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<readonly AttendanceEmployeeOption[] | null>(null);
  const [preset, setPreset] = useState<Preset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [limitToSelected, setLimitToSelected] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [empSearch, setEmpSearch] = useState('');
  const [calendarLayout, setCalendarLayout] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || employees !== null) return;
    listAttendanceEmployees()
      .then(setEmployees)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not load employees'));
  }, [open, employees]);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== 'custom') {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  const dayCount = useMemo(() => eachIsoDate(from, to).length, [from, to]);
  const filteredEmployees = useMemo(() => {
    const list = employees ?? [];
    const q = empSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) =>
      [e.fullName, e.employeeCode, e.designation, e.department].some((v) =>
        (v ?? '').toLowerCase().includes(q),
      ),
    );
  }, [employees, empSearch]);

  const targetCount = limitToSelected ? selected.size : (employees?.length ?? 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function doExport(format: ExportFormat) {
    if (from > to) {
      toast.error('The start date must be on or before the end date.');
      return;
    }
    if (dayCount === 0) {
      toast.error('Pick a valid date range.');
      return;
    }
    if (dayCount > MAX_DAYS) {
      toast.error(`That range is ${dayCount} days — keep it under ${MAX_DAYS}.`);
      return;
    }
    if (limitToSelected && selected.size === 0) {
      toast.error('Pick at least one employee, or switch to all employees.');
      return;
    }
    setBusy(true);
    try {
      const employeeIds = limitToSelected ? Array.from(selected) : undefined;
      const { employees: emps, records } = await getAttendanceForExport({
        fromDate: from,
        toDate: to,
        employeeIds,
      });
      if (emps.length === 0) {
        toast.error('No employees to export.');
        return;
      }
      const byCell = new Map<string, { status: AttendanceStatus; notes: string | null }>();
      for (const r of records) byCell.set(`${r.employeeId}|${r.date}`, r);

      const dates = eachIsoDate(from, to);
      const statusFor = (empId: string, date: string): AttendanceStatus =>
        byCell.get(`${empId}|${date}`)?.status ?? defaultStatusForDate(date);

      const generatedLabel = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      if (calendarLayout) {
        // Muster-roll grid: one block per month, employees × days, a status in
        // every cell. Applies to both PDF and Excel.
        const months: CalendarMonth[] = splitIntoMonths(dates).map((g) => ({
          label: g.label,
          days: g.days.map((iso) => ({
            iso,
            dayNum: Number(iso.slice(8, 10)),
            weekday: weekdayShort(iso),
            isSunday: new Date(`${iso}T00:00:00Z`).getUTCDay() === 0,
          })),
          rows: emps.map((e): CalendarRow => {
            const statuses = g.days.map((iso) => statusFor(e.id, iso));
            return {
              employeeCode: e.employeeCode,
              employeeName: e.fullName,
              statuses,
              stats: computeAttendanceStats(statuses),
            };
          }),
        }));
        // Per-employee totals across the WHOLE range (every selected date),
        // for the Summary sheet at the end of the workbook.
        const summaryRows = emps.map((e) => ({
          employeeCode: e.employeeCode,
          employeeName: e.fullName,
          stats: computeAttendanceStats(dates.map((d) => statusFor(e.id, d))),
        }));
        const calData: AttendanceCalendarData = {
          fromDate: from,
          toDate: to,
          generatedLabel,
          months,
          summary: {
            rows: summaryRows,
            totals: aggregateAttendanceStats(summaryRows.map((r) => r.stats)),
          },
        };
        if (format === 'pdf') {
          const { downloadAttendanceCalendarPdf } = await import('./attendance-calendar-pdf');
          await downloadAttendanceCalendarPdf(calData, `attendance-calendar-${from}_to_${to}`);
        } else {
          const { downloadAttendanceCalendarXlsx } = await import('./attendance-calendar-xlsx');
          downloadAttendanceCalendarXlsx(calData, `attendance-calendar-${from}_to_${to}`);
        }
        toast.success(
          `Exported calendar — ${emps.length} employee${emps.length === 1 ? '' : 's'} across ${
            months.length
          } month${months.length === 1 ? '' : 's'}.`,
        );
        setOpen(false);
        return;
      }

      if (format === 'pdf') {
        // A proper report: per-employee figures (working days, present, WFH,
        // half-days, leave, absent, weekly-offs, holidays, attendance %), a
        // totals row, and a day-by-day breakdown when one employee is exported.
        const reportRows: AttendanceReportRow[] = emps.map((e) => ({
          employeeCode: e.employeeCode,
          employeeName: e.fullName,
          designation: e.designation,
          department: e.department,
          stats: computeAttendanceStats(dates.map((d) => statusFor(e.id, d))),
        }));
        const totals = aggregateAttendanceStats(reportRows.map((r) => r.stats));
        const only = emps.length === 1 ? emps[0]! : null;

        const data: AttendanceReportData = {
          fromDate: from,
          toDate: to,
          rangeDays: dates.length,
          generatedLabel,
          rows: reportRows,
          totals,
          daily: only
            ? {
                employeeName: only.fullName,
                employeeCode: only.employeeCode,
                rows: dates.map((d) => ({
                  date: d,
                  day: weekdayShort(d),
                  status: statusFor(only.id, d),
                  notes: byCell.get(`${only.id}|${d}`)?.notes ?? '',
                })),
              }
            : undefined,
        };

        const { downloadAttendanceReportPdf } = await import('./attendance-report-pdf');
        await downloadAttendanceReportPdf(data, `attendance-report-${from}_to_${to}`);
        toast.success(
          `Exported attendance report — ${emps.length} employee${
            emps.length === 1 ? '' : 's'
          }, ${dates.length} day${dates.length === 1 ? '' : 's'}.`,
        );
        setOpen(false);
        return;
      }

      // Excel — detailed day-by-day rows (one per employee per date).
      const headers = ['Employee Code', 'Employee', 'Date', 'Day', 'Status', 'Notes'];
      const rows: Record<string, string>[] = [];
      for (const e of emps) {
        for (const date of dates) {
          const rec = byCell.get(`${e.id}|${date}`);
          rows.push({
            'Employee Code': e.employeeCode,
            Employee: e.fullName,
            Date: date,
            Day: weekdayShort(date),
            Status: STATUS_EXPORT_LABEL[statusFor(e.id, date)],
            Notes: rec?.notes ?? '',
          });
        }
      }

      exportRows(rows, headers, `attendance-${from}_to_${to}`, 'xlsx', 'Attendance');
      toast.success(
        `Exported ${rows.length} row${rows.length === 1 ? '' : 's'} (${emps.length} employee${
          emps.length === 1 ? '' : 's'
        } × ${dates.length} day${dates.length === 1 ? '' : 's'}).`,
      );
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <DialogTrigger asChild>
        <button type="button" className="btn" title="Export attendance to PDF or Excel">
          Export
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Export attendance</DialogTitle>
          <DialogDescription>
            <strong>PDF</strong> is a summary report — per-employee working days, present, leave,
            absent and attendance % (plus a day-by-day breakdown for a single employee).{' '}
            <strong>Excel</strong> gives the full day-by-day data. Unmarked days use the default
            (present on weekdays, weekly-off on Sundays).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Range */}
          <div className="grid gap-2">
            <Label>Range</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.key}
                  type="button"
                  size="sm"
                  variant={preset === p.key ? 'default' : 'outline'}
                  onClick={() => applyPreset(p.key)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <DateField
                value={from}
                onChange={(next) => {
                  setFrom(next);
                  setPreset('custom');
                }}
                clearable={false}
                className="h-8"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <DateField
                value={to}
                onChange={(next) => {
                  setTo(next);
                  setPreset('custom');
                }}
                clearable={false}
                className="h-8"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {dayCount > 0
                ? `${dayCount} day${dayCount === 1 ? '' : 's'} · ${targetCount} employee${
                    targetCount === 1 ? '' : 's'
                  }`
                : 'Pick a valid range.'}
            </p>
          </div>

          {/* Employees */}
          <div className="grid gap-2">
            <Label className="font-normal">
              <Checkbox
                checked={limitToSelected}
                onCheckedChange={(v) => setLimitToSelected(v === true)}
              />
              Limit to selected employees
            </Label>

            {limitToSelected && (
              <div className="rounded-md border">
                <div className="flex items-center gap-2 border-b p-2">
                  <Input
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Search name, code, department…"
                    className="h-7"
                    aria-label="Search employees"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set(filteredEmployees.map((e) => e.id)))}
                    disabled={!employees}
                  >
                    All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set())}
                    disabled={selected.size === 0}
                  >
                    Clear
                  </Button>
                </div>
                <div className="max-h-44 overflow-auto p-1">
                  {employees === null ? (
                    <p className="text-muted-foreground p-2 text-sm">Loading…</p>
                  ) : filteredEmployees.length === 0 ? (
                    <p className="text-muted-foreground p-2 text-sm">No matching employees.</p>
                  ) : (
                    filteredEmployees.map((e) => (
                      <label
                        key={e.id}
                        className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                      >
                        <Checkbox
                          checked={selected.has(e.id)}
                          onCheckedChange={() => toggle(e.id)}
                        />
                        <span className="flex-1 truncate">
                          {e.fullName}
                          <span className="text-muted-foreground"> · {e.employeeCode}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Layout */}
          <div className="grid gap-2">
            <Label className="font-normal">
              <Checkbox
                checked={calendarLayout}
                onCheckedChange={(v) => setCalendarLayout(v === true)}
              />
              Calendar grid (one column per day, by month)
            </Label>
            {calendarLayout ? (
              <p className="text-muted-foreground text-xs">
                Each month becomes a grid of employees × days — every day shows the status (P / W /
                A / H / L / · / X) — in both the PDF and Excel.
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => doExport('pdf')} disabled={busy}>
            {busy ? 'Exporting…' : 'Export PDF'}
          </Button>
          <Button onClick={() => doExport('xlsx')} disabled={busy}>
            {busy ? 'Exporting…' : 'Export Excel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
