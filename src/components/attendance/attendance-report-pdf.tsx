'use client';

// Rich attendance PDF — a proper report, not a flat day-by-day dump. Renders a
// per-employee summary (working days, present, WFH, half-days, leave, absent,
// weekly-offs, holidays, and attendance %), a totals row, and — when the export
// is scoped to a single employee — a full day-by-day breakdown. Loaded via a
// dynamic import (heavy @react-pdf/renderer) only when a PDF is generated.

import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import * as React from 'react';

import type { AttendanceStatus } from '@/lib/server/entities/attendance';
import { STATUS_EXPORT_LABEL, type AttendanceStats } from './attendance-io';

export type AttendanceReportRow = {
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  department: string | null;
  stats: AttendanceStats;
};

export type AttendanceDailyRow = {
  date: string; // ISO
  day: string; // weekday short
  status: AttendanceStatus;
  notes: string;
};

export type AttendanceReportData = {
  fromDate: string;
  toDate: string;
  rangeDays: number;
  generatedLabel: string;
  rows: readonly AttendanceReportRow[];
  totals: AttendanceStats;
  /** Present only when the export is scoped to a single employee. */
  daily?: { employeeName: string; employeeCode: string; rows: readonly AttendanceDailyRow[] };
};

type Col = { key: string; label: string; width: string; align: 'left' | 'center' };

// Summary columns (widths sum to 100%).
const COLS: readonly Col[] = [
  { key: 'code', label: 'Code', width: '9%', align: 'left' },
  { key: 'name', label: 'Employee', width: '21%', align: 'left' },
  { key: 'working', label: 'Work days', width: '9%', align: 'center' },
  { key: 'present', label: 'Present', width: '8%', align: 'center' },
  { key: 'wfh', label: 'WFH', width: '7%', align: 'center' },
  { key: 'half', label: 'Half-day', width: '8%', align: 'center' },
  { key: 'leave', label: 'On leave', width: '7%', align: 'center' },
  { key: 'absent', label: 'Absent', width: '8%', align: 'center' },
  { key: 'off', label: 'Weekly off', width: '7%', align: 'center' },
  { key: 'holiday', label: 'Holiday', width: '8%', align: 'center' },
  { key: 'pct', label: 'Attend. %', width: '8%', align: 'center' },
];

const styles = StyleSheet.create({
  page: { paddingVertical: 26, paddingHorizontal: 26, fontSize: 8, color: '#1a1a1a' },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  meta: { fontSize: 8.5, color: '#555', marginTop: 3, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 6 },
  table: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: '#c4c9cf' },
  row: { flexDirection: 'row' },
  headerRow: { backgroundColor: '#e7ebef' },
  zebra: { backgroundColor: '#f6f8f9' },
  totalRow: { backgroundColor: '#eef1f3' },
  cell: {
    paddingVertical: 3.5,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#c4c9cf',
  },
  headerCell: { fontFamily: 'Helvetica-Bold' },
  bold: { fontFamily: 'Helvetica-Bold' },
  defs: { fontSize: 7.5, color: '#777', marginTop: 10, lineHeight: 1.4 },
  footer: {
    position: 'absolute',
    bottom: 12,
    left: 26,
    right: 26,
    fontSize: 7,
    color: '#9a9a9a',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function pct(stats: AttendanceStats): string {
  if (stats.workingDays === 0) return '—';
  return `${stats.attendancePct.toFixed(1)}%`;
}

function pctColor(stats: AttendanceStats): string | undefined {
  if (stats.workingDays === 0) return undefined;
  if (stats.attendancePct >= 90) return '#1a7a4d';
  if (stats.attendancePct >= 75) return '#b07d12';
  return '#c0392b';
}

/** A count, rendered as integer or with a trailing ½ for half-day totals. */
function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function valuesFor(stats: AttendanceStats): Record<string, string> {
  return {
    working: num(stats.workingDays),
    present: num(stats.counts.present),
    wfh: num(stats.counts.work_from_home),
    half: num(stats.counts.half_day),
    leave: num(stats.counts.on_leave),
    absent: num(stats.counts.absent),
    off: num(stats.counts.weekly_off),
    holiday: num(stats.counts.holiday),
    pct: pct(stats),
  };
}

function HeaderRow() {
  return (
    <View style={[styles.row, styles.headerRow]} fixed>
      {COLS.map((c) => (
        <Text
          key={c.key}
          style={[styles.cell, styles.headerCell, { width: c.width, textAlign: c.align }]}
        >
          {c.label}
        </Text>
      ))}
    </View>
  );
}

function SummaryRow({ row, zebra }: { row: AttendanceReportRow; zebra: boolean }) {
  const v = valuesFor(row.stats);
  const color = pctColor(row.stats);
  return (
    <View style={zebra ? [styles.row, styles.zebra] : styles.row} wrap={false}>
      <Text style={[styles.cell, { width: COLS[0]!.width, textAlign: 'left' }]}>
        {row.employeeCode}
      </Text>
      <Text style={[styles.cell, { width: COLS[1]!.width, textAlign: 'left' }]}>
        {row.employeeName}
      </Text>
      {COLS.slice(2).map((c) => (
        <Text
          key={c.key}
          style={[
            styles.cell,
            { width: c.width, textAlign: c.align },
            c.key === 'pct' && color ? { color, fontFamily: 'Helvetica-Bold' } : {},
          ]}
        >
          {v[c.key]}
        </Text>
      ))}
    </View>
  );
}

function TotalsRow({ totals, count }: { totals: AttendanceStats; count: number }) {
  const v = valuesFor(totals);
  return (
    <View style={[styles.row, styles.totalRow]} wrap={false}>
      <Text style={[styles.cell, styles.bold, { width: COLS[0]!.width, textAlign: 'left' }]}>
        TOTAL
      </Text>
      <Text style={[styles.cell, styles.bold, { width: COLS[1]!.width, textAlign: 'left' }]}>
        {count} employee{count === 1 ? '' : 's'}
      </Text>
      {COLS.slice(2).map((c) => (
        <Text
          key={c.key}
          style={[styles.cell, styles.bold, { width: c.width, textAlign: c.align }]}
        >
          {v[c.key]}
        </Text>
      ))}
    </View>
  );
}

const DAILY_COLS: readonly Col[] = [
  { key: 'date', label: 'Date', width: '20%', align: 'left' },
  { key: 'day', label: 'Day', width: '12%', align: 'left' },
  { key: 'status', label: 'Status', width: '34%', align: 'left' },
  { key: 'notes', label: 'Notes', width: '34%', align: 'left' },
];

function DailyDetail({ daily }: { daily: NonNullable<AttendanceReportData['daily']> }) {
  return (
    <View break>
      <Text style={styles.sectionTitle}>
        Daily detail — {daily.employeeName} ({daily.employeeCode})
      </Text>
      <View style={styles.table}>
        <View style={[styles.row, styles.headerRow]} fixed>
          {DAILY_COLS.map((c) => (
            <Text
              key={c.key}
              style={[styles.cell, styles.headerCell, { width: c.width, textAlign: c.align }]}
            >
              {c.label}
            </Text>
          ))}
        </View>
        {daily.rows.map((r, i) => (
          <View
            key={r.date}
            style={i % 2 === 1 ? [styles.row, styles.zebra] : styles.row}
            wrap={false}
          >
            <Text style={[styles.cell, { width: '20%' }]}>{fmtDate(r.date)}</Text>
            <Text style={[styles.cell, { width: '12%' }]}>{r.day}</Text>
            <Text style={[styles.cell, { width: '34%' }]}>{STATUS_EXPORT_LABEL[r.status]}</Text>
            <Text style={[styles.cell, { width: '34%' }]}>{r.notes}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function AttendanceReport({ data }: { data: AttendanceReportData }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>Attendance Report</Text>
        <Text style={styles.meta}>
          Period: {fmtDate(data.fromDate)} → {fmtDate(data.toDate)} ({data.rangeDays} day
          {data.rangeDays === 1 ? '' : 's'}) · {data.rows.length} employee
          {data.rows.length === 1 ? '' : 's'} · Generated {data.generatedLabel}
        </Text>

        <View style={styles.table}>
          <HeaderRow />
          {data.rows.map((row, i) => (
            <SummaryRow key={row.employeeCode + i} row={row} zebra={i % 2 === 1} />
          ))}
          <TotalsRow totals={data.totals} count={data.rows.length} />
        </View>

        <Text style={styles.defs}>
          Working days = period days excluding weekly-offs and holidays. Attendance % = (Present +
          WFH + ½·Half-day) ÷ Working days. A half-day counts as 0.5 present. Weekly-off defaults to
          Sunday; days without a marked status are treated as Present (weekday) or Weekly off
          (Sunday).
        </Text>

        {data.daily && data.daily.rows.length > 0 ? <DailyDetail daily={data.daily} /> : null}

        <View style={styles.footer} fixed>
          <Text>Attendance Report</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
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

export async function downloadAttendanceReportPdf(
  data: AttendanceReportData,
  filename: string,
): Promise<void> {
  const blob = await pdf(<AttendanceReport data={data} />).toBlob();
  triggerDownload(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
