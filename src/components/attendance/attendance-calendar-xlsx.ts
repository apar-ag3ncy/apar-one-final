// Calendar (muster-roll) attendance Excel — one sheet per month, a grid of
// employees (rows) × days (columns) with a single-letter status in each cell,
// plus per-employee summary columns. A leading "Legend" sheet explains the
// codes. XLSX is already in the bundle via `export-rows`, so no extra weight.

import * as XLSX from 'xlsx';

import {
  STATUS_EXPORT_LABEL,
  STATUS_SHORT,
  type AttendanceCalendarData,
  type CalendarMonth,
} from './attendance-io';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Excel sheet names: ≤31 chars and free of : \ / ? * [ ]. */
function sheetName(label: string, used: Set<string>): string {
  let base =
    label
      .replace(/[:\\/?*[\]]/g, ' ')
      .slice(0, 31)
      .trim() || 'Sheet';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    base = label.slice(0, 31 - suffix.length);
    name = base + suffix;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function legendSheet(data: AttendanceCalendarData): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    ['Attendance — calendar (muster roll)'],
    [`Period: ${data.fromDate} to ${data.toDate}`],
    [`Generated: ${data.generatedLabel}`],
    [],
    ['Code', 'Meaning'],
    ...(Object.keys(STATUS_SHORT) as (keyof typeof STATUS_SHORT)[]).map((k) => [
      STATUS_SHORT[k],
      STATUS_EXPORT_LABEL[k],
    ]),
    [],
    ['Working days', 'Period days excluding weekly-offs and holidays'],
    ['Attendance %', '(Present + WFH + ½·Half-day) ÷ Working days'],
    ['Each month', 'Has its own sheet — columns are the days of that month'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 52 }];
  return ws;
}

function monthSheet(month: CalendarMonth): XLSX.WorkSheet {
  const dayNums = month.days.map((d) => d.dayNum);
  const summaryHeaders = [
    'Present',
    'Absent',
    'WFH',
    'Half-day',
    'On leave',
    'Weekly off',
    'Holiday',
    'Working days',
    'Attendance %',
  ];
  const header: (string | number)[] = ['Employee Code', 'Employee', ...dayNums, ...summaryHeaders];
  const weekdayRow: (string | number)[] = [
    '',
    '',
    ...month.days.map((d) => d.weekday),
    ...summaryHeaders.map(() => ''),
  ];

  const body = month.rows.map((r) => [
    r.employeeCode,
    r.employeeName,
    ...r.statuses.map((s) => STATUS_SHORT[s]),
    r.stats.counts.present,
    r.stats.counts.absent,
    r.stats.counts.work_from_home,
    r.stats.counts.half_day,
    r.stats.counts.on_leave,
    r.stats.counts.weekly_off,
    r.stats.counts.holiday,
    r.stats.workingDays,
    r.stats.workingDays > 0 ? Number(r.stats.attendancePct.toFixed(1)) : 0,
  ]);

  const aoa: (string | number)[][] = [[month.label], header, weekdayRow, ...body];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 13 },
    { wch: 22 },
    ...month.days.map(() => ({ wch: 3.5 })),
    ...summaryHeaders.map((h) => ({ wch: Math.max(8, h.length) })),
  ];
  return ws;
}

export function downloadAttendanceCalendarXlsx(
  data: AttendanceCalendarData,
  filename: string,
): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, legendSheet(data), 'Legend');
  const used = new Set<string>(['legend']);
  for (const month of data.months) {
    XLSX.utils.book_append_sheet(wb, monthSheet(month), sheetName(month.label, used));
  }
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
