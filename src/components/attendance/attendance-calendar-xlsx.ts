// Calendar (muster-roll) attendance Excel — one sheet per month, a grid of
// employees (rows) × days (columns) with a COLOUR-CODED status in each cell
// (matching the PDF), plus per-employee summary columns. Month sheets come
// first; a "Legend" sheet (with coloured swatches) is last. Uses
// `xlsx-js-style` (a styled fork of SheetJS) because the community `xlsx`
// build drops cell fills on write.

import * as XLSX from 'xlsx-js-style';

import {
  ALL_STATUSES,
  STATUS_COLOR,
  STATUS_EXPORT_LABEL,
  STATUS_SHORT,
  type AttendanceCalendarData,
  type CalendarMonth,
} from './attendance-io';
import type { AttendanceStatus } from '@/lib/server/entities/attendance';

type CellStyle = Record<string, unknown>;

const THIN = { style: 'thin', color: { rgb: 'C4C9CF' } };
const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const HEADER_FILL = { patternType: 'solid', fgColor: { rgb: 'E7EBEF' } };
const SUN_FILL = { patternType: 'solid', fgColor: { rgb: 'F6DCD8' } };

function hex(c: string): string {
  return c.replace('#', '').toUpperCase();
}

function statusCellStyle(s: AttendanceStatus): CellStyle {
  return {
    fill: { patternType: 'solid', fgColor: { rgb: hex(STATUS_COLOR[s]) } },
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 9 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: BORDERS,
  };
}

/** Set a cell's style, creating an empty cell first if it doesn't exist. */
function setStyle(ws: Record<string, unknown>, r: number, c: number, style: CellStyle): void {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = (ws[addr] ?? (ws[addr] = { t: 's', v: '' })) as { s?: CellStyle };
  cell.s = style;
}

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

const SUMMARY_HEADERS = [
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

function monthSheet(month: CalendarMonth): XLSX.WorkSheet {
  const nDays = month.days.length;
  const dayStart = 2;
  const lastCol = dayStart + nDays + SUMMARY_HEADERS.length - 1;
  const isSunday = (c: number) =>
    c >= dayStart && c < dayStart + nDays && month.days[c - dayStart]!.isSunday;

  const title = [month.label];
  const header = [
    'Employee Code',
    'Employee',
    ...month.days.map((d) => d.dayNum),
    ...SUMMARY_HEADERS,
  ];
  const weekday = [
    '',
    '',
    ...month.days.map((d) => d.weekday.slice(0, 1)),
    ...SUMMARY_HEADERS.map(() => ''),
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

  const ws = XLSX.utils.aoa_to_sheet([title, header, weekday, ...body]);
  ws['!cols'] = [
    { wch: 13 },
    { wch: 22 },
    ...month.days.map(() => ({ wch: 3.6 })),
    ...SUMMARY_HEADERS.map((h) => ({ wch: Math.max(7, h.length) })),
  ];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(lastCol, dayStart + 6) } }];

  // Title
  setStyle(ws, 0, 0, { font: { bold: true, sz: 14 }, alignment: { horizontal: 'left' } });
  // Header (day numbers + summary) — row 1
  for (let c = 0; c <= lastCol; c++) {
    if (c < 2) {
      setStyle(ws, 1, c, {
        font: { bold: true },
        fill: HEADER_FILL,
        alignment: { horizontal: 'left', vertical: 'center' },
        border: BORDERS,
      });
    } else {
      setStyle(ws, 1, c, {
        font: { bold: true, color: { rgb: isSunday(c) ? 'C0392B' : '1A1A1A' } },
        fill: isSunday(c) ? SUN_FILL : HEADER_FILL,
        alignment: { horizontal: 'center', vertical: 'center' },
        border: BORDERS,
      });
    }
  }
  // Weekday initials — row 2
  for (let c = 0; c <= lastCol; c++) {
    const dayCol = c >= dayStart && c < dayStart + nDays;
    setStyle(ws, 2, c, {
      font: dayCol ? { sz: 8, color: { rgb: isSunday(c) ? 'C0392B' : '888888' } } : undefined,
      fill: isSunday(c) ? SUN_FILL : HEADER_FILL,
      alignment: { horizontal: 'center' },
      border: BORDERS,
    });
  }
  // Body rows — row 3+
  month.rows.forEach((r, ri) => {
    const row = 3 + ri;
    setStyle(ws, row, 0, { border: BORDERS, alignment: { horizontal: 'left' } });
    setStyle(ws, row, 1, { border: BORDERS, alignment: { horizontal: 'left' } });
    r.statuses.forEach((s, di) => setStyle(ws, row, dayStart + di, statusCellStyle(s)));
    for (let k = 0; k < SUMMARY_HEADERS.length; k++) {
      const isAtt = k === SUMMARY_HEADERS.length - 1;
      setStyle(ws, row, dayStart + nDays + k, {
        border: BORDERS,
        alignment: { horizontal: 'center' },
        font: isAtt ? { bold: true } : undefined,
      });
    }
  });
  return ws;
}

function legendSheet(data: AttendanceCalendarData): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    ['Attendance — calendar (muster roll)'],
    [`Period: ${data.fromDate} to ${data.toDate}`],
    [`Generated: ${data.generatedLabel}`],
    [],
    ['Code', 'Meaning'],
    ...ALL_STATUSES.map((s) => [STATUS_SHORT[s], STATUS_EXPORT_LABEL[s]]),
    [],
    ['Working days', 'Period days excluding weekly-offs and holidays'],
    ['Attendance %', '(Present + WFH + ½·Half-day) ÷ Working days'],
    ['Each month', 'Has its own sheet — columns are the days of that month'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 10 }, { wch: 54 }];
  setStyle(ws, 0, 0, { font: { bold: true, sz: 13 } });
  setStyle(ws, 4, 0, { font: { bold: true } });
  setStyle(ws, 4, 1, { font: { bold: true } });
  // Coloured swatch for each status code (rows start at index 5).
  ALL_STATUSES.forEach((s, i) => setStyle(ws, 5 + i, 0, statusCellStyle(s)));
  return ws;
}

export function downloadAttendanceCalendarXlsx(
  data: AttendanceCalendarData,
  filename: string,
): void {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  // Month sheets first so the workbook opens on real data, legend last.
  for (const month of data.months) {
    XLSX.utils.book_append_sheet(wb, monthSheet(month), sheetName(month.label, used));
  }
  XLSX.utils.book_append_sheet(wb, legendSheet(data), sheetName('Legend', used));

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
