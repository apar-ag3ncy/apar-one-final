'use client';

// Calendar (muster-roll) attendance PDF — one page per month, a grid of
// employees (rows) × days (columns) with a colour-coded status in every cell,
// plus per-employee Present / Absent / Attendance-% totals and a legend. Loaded
// via a dynamic import (heavy @react-pdf/renderer) only when a PDF is generated.

import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import * as React from 'react';

import {
  STATUS_COLOR,
  STATUS_EXPORT_LABEL,
  STATUS_SHORT,
  type AttendanceCalendarData,
  type CalendarDay,
  type CalendarMonth,
  type CalendarRow,
} from './attendance-io';
import type { AttendanceStatus } from '@/lib/server/entities/attendance';

const NAME_W = '13%';
const SUMMARY_W = '5%'; // ×3 trailing columns
const DAYS_TOTAL = 72; // % shared across the day columns

const LEGEND_ORDER: readonly AttendanceStatus[] = [
  'present',
  'work_from_home',
  'half_day',
  'on_leave',
  'absent',
  'weekly_off',
  'holiday',
];

const styles = StyleSheet.create({
  page: { paddingVertical: 24, paddingHorizontal: 22, fontSize: 7, color: '#1a1a1a' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  meta: { fontSize: 8, color: '#555', marginTop: 2, marginBottom: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontSize: 7, color: '#444' },
  table: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: '#c4c9cf' },
  row: { flexDirection: 'row' },
  headerRow: { backgroundColor: '#e7ebef' },
  zebra: { backgroundColor: '#f6f8f9' },
  cell: {
    paddingVertical: 2.5,
    paddingHorizontal: 1,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#c4c9cf',
    textAlign: 'center',
  },
  nameCell: { paddingHorizontal: 4, textAlign: 'left' },
  headerCell: { fontFamily: 'Helvetica-Bold' },
  sunday: { color: '#c0392b' },
  statusCell: { color: '#ffffff', fontFamily: 'Helvetica-Bold' },
  footer: {
    position: 'absolute',
    bottom: 12,
    left: 22,
    right: 22,
    fontSize: 7,
    color: '#9a9a9a',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

function Legend() {
  return (
    <View style={styles.legend}>
      {LEGEND_ORDER.map((s) => (
        <View key={s} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: STATUS_COLOR[s] }]} />
          <Text style={styles.legendText}>
            {STATUS_SHORT[s]} = {STATUS_EXPORT_LABEL[s]}
          </Text>
        </View>
      ))}
    </View>
  );
}

function HeaderRows({ days, dayW }: { days: readonly CalendarDay[]; dayW: string }) {
  return (
    <View fixed>
      {/* Day numbers */}
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.cell, styles.nameCell, styles.headerCell, { width: NAME_W }]}>
          Employee
        </Text>
        {days.map((d) => (
          <Text
            key={d.iso}
            style={[
              styles.cell,
              styles.headerCell,
              { width: dayW },
              d.isSunday ? styles.sunday : {},
            ]}
          >
            {d.dayNum}
          </Text>
        ))}
        <Text style={[styles.cell, styles.headerCell, { width: SUMMARY_W }]}>Pres</Text>
        <Text style={[styles.cell, styles.headerCell, { width: SUMMARY_W }]}>Abs</Text>
        <Text style={[styles.cell, styles.headerCell, { width: SUMMARY_W }]}>Att%</Text>
      </View>
      {/* Weekday initials */}
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.cell, styles.nameCell, { width: NAME_W, color: '#777' }]}> </Text>
        {days.map((d) => (
          <Text
            key={d.iso}
            style={[styles.cell, { width: dayW, color: d.isSunday ? '#c0392b' : '#888' }]}
          >
            {d.weekday.slice(0, 1)}
          </Text>
        ))}
        <Text style={[styles.cell, { width: SUMMARY_W }]}> </Text>
        <Text style={[styles.cell, { width: SUMMARY_W }]}> </Text>
        <Text style={[styles.cell, { width: SUMMARY_W }]}> </Text>
      </View>
    </View>
  );
}

function EmployeeRow({ row, dayW, zebra }: { row: CalendarRow; dayW: string; zebra: boolean }) {
  const att = row.stats.workingDays > 0 ? `${row.stats.attendancePct.toFixed(0)}%` : '—';
  return (
    <View style={zebra ? [styles.row, styles.zebra] : styles.row} wrap={false}>
      <Text style={[styles.cell, styles.nameCell, { width: NAME_W }]}>{row.employeeName}</Text>
      {row.statuses.map((s, i) => (
        <Text
          key={i}
          style={[
            styles.cell,
            styles.statusCell,
            { width: dayW, backgroundColor: STATUS_COLOR[s] },
          ]}
        >
          {STATUS_SHORT[s]}
        </Text>
      ))}
      <Text style={[styles.cell, { width: SUMMARY_W }]}>{row.stats.counts.present}</Text>
      <Text style={[styles.cell, { width: SUMMARY_W }]}>{row.stats.counts.absent}</Text>
      <Text style={[styles.cell, { width: SUMMARY_W }]}>{att}</Text>
    </View>
  );
}

function MonthPage({ month, meta }: { month: CalendarMonth; meta: string }) {
  const dayW = `${DAYS_TOTAL / Math.max(1, month.days.length)}%`;
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <Text style={styles.title}>{month.label} — Attendance</Text>
      <Text style={styles.meta}>{meta}</Text>
      <Legend />
      <View style={styles.table}>
        <HeaderRows days={month.days} dayW={dayW} />
        {month.rows.map((r, i) => (
          <EmployeeRow key={r.employeeCode + i} row={r} dayW={dayW} zebra={i % 2 === 1} />
        ))}
      </View>
      <View style={styles.footer} fixed>
        <Text>{month.label} · Attendance</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  );
}

function AttendanceCalendar({ data }: { data: AttendanceCalendarData }) {
  return (
    <Document>
      {data.months.map((m) => (
        <MonthPage
          key={m.label}
          month={m}
          meta={`${m.rows.length} employee${m.rows.length === 1 ? '' : 's'} · ${
            m.days.length
          } day${m.days.length === 1 ? '' : 's'} · Generated ${data.generatedLabel}`}
        />
      ))}
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

export async function downloadAttendanceCalendarPdf(
  data: AttendanceCalendarData,
  filename: string,
): Promise<void> {
  const blob = await pdf(<AttendanceCalendar data={data} />).toBlob();
  triggerDownload(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
