'use client';

// Bulk-import attendance from an Excel (.xlsx/.xls) or CSV file. Each row maps
// an employee (by Employee Code, Work Email, or exact Full Name) + a date to a
// status. Mirrors the round-trip export: a status equal to the implicit
// default stores nothing (and clears a prior override), so re-importing an
// untouched export is a no-op rather than thousands of "present" rows.

import { useRef, useState } from 'react';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileIcon,
  UploadIcon,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { importAttendance, type AttendanceImportRow } from '@/lib/server/entities/attendance';

import { STATUS_EXPORT_LABEL, normalizeStatus, toIsoDate } from './attendance-io';

type ColumnKey = 'code' | 'email' | 'name' | 'date' | 'status' | 'notes';

// Header aliases (normalised) accepted when reading an uploaded file. The
// export's "Day" (weekday) column is deliberately not a `date` alias.
const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  code: ['employee_code', 'code', 'emp_code', 'empcode', 'employee_id', 'emp_id'],
  email: ['work_email', 'email', 'workemail', 'email_id', 'official_email'],
  name: ['employee', 'name', 'full_name', 'employee_name', 'fullname'],
  date: ['date', 'attendance_date', 'dt'],
  status: ['status', 'attendance', 'state', 'mark'],
  notes: ['notes', 'note', 'remark', 'remarks', 'comment', 'comments'],
};

type RowError = { row: number; label: string; message: string };

type ImportOutcome = {
  successCount: number;
  clearedCount: number;
  total: number;
  errors: RowError[];
};

const ACCEPTED_STATUSES = Object.values(STATUS_EXPORT_LABEL);

export function ImportAttendanceDialog({ onImported }: { onImported?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setError(null);
    setOutcome(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    setError(null);
    setOutcome(null);
    if (!selected) return;
    if (!/\.(xlsx|xls|csv)$/i.test(selected.name)) {
      setError('Please upload an Excel (.xlsx, .xls) or CSV file.');
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
      const sheetName = wb.SheetNames.find((n) => /attendance/i.test(n)) ?? wb.SheetNames[0];
      if (!sheetName) throw new Error('The workbook has no sheets.');
      const ws = wb.Sheets[sheetName]!;
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: false,
        dateNF: 'yyyy-mm-dd',
        defval: '',
        blankrows: false,
      });
      if (aoa.length < 2) {
        throw new Error('The file has no data rows — add at least one row under the headers.');
      }

      const headers = (aoa[0] as unknown[]).map((h) => normalizeHeader(String(h ?? '')));
      const colIndex = {} as Record<ColumnKey, number>;
      for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
        colIndex[key] = firstHeaderIndex(headers, COLUMN_ALIASES[key]);
      }
      if (colIndex.code === -1 && colIndex.email === -1 && colIndex.name === -1) {
        throw new Error(
          'Could not find an Employee Code, Email or Employee column. Download the template and keep the header row.',
        );
      }
      if (colIndex.date === -1) {
        throw new Error('Could not find a "Date" column.');
      }
      if (colIndex.status === -1) {
        throw new Error('Could not find a "Status" column.');
      }

      const cell = (row: unknown[], key: ColumnKey): string => {
        const idx = colIndex[key];
        if (idx === -1) return '';
        return String(row[idx] ?? '').trim();
      };

      const payload: AttendanceImportRow[] = [];
      const meta: { row: number; label: string }[] = [];
      const localErrors: RowError[] = [];

      for (let i = 1; i < aoa.length; i++) {
        const row = aoa[i] as unknown[];
        const code = cell(row, 'code');
        const email = cell(row, 'email');
        const name = cell(row, 'name');
        const dateRaw = cell(row, 'date');
        const statusRaw = cell(row, 'status');
        const notes = cell(row, 'notes');
        const sheetRow = i + 1; // 1-based; header is sheet row 1

        if (!code && !email && !name && !dateRaw && !statusRaw) continue; // blank row
        const label = code || email || name || `Row ${sheetRow}`;

        if (!code && !email && !name) {
          localErrors.push({ row: sheetRow, label, message: 'No Employee Code / Email / Name.' });
          continue;
        }
        const date = toIsoDate(dateRaw);
        if (!date) {
          localErrors.push({ row: sheetRow, label, message: `Unreadable date "${dateRaw}".` });
          continue;
        }
        const status = normalizeStatus(statusRaw);
        if (!status) {
          localErrors.push({ row: sheetRow, label, message: `Unknown status "${statusRaw}".` });
          continue;
        }

        payload.push({
          code: code || undefined,
          email: email || undefined,
          name: name || undefined,
          date,
          status,
          notes: notes || undefined,
        });
        meta.push({ row: sheetRow, label });
      }

      if (payload.length === 0 && localErrors.length === 0) {
        throw new Error('No data rows found under the headers.');
      }

      const result = payload.length
        ? await importAttendance(payload)
        : {
            successCount: 0,
            clearedCount: 0,
            errors: [] as { index: number; ref: string; message: string }[],
          };

      const serverErrors: RowError[] = result.errors.map((e) => ({
        row: meta[e.index]?.row ?? 0,
        label: e.ref || meta[e.index]?.label || '',
        message: e.message,
      }));
      const errors = [...localErrors, ...serverErrors].sort((a, b) => a.row - b.row);
      const total = payload.length + localErrors.length;

      setOutcome({
        successCount: result.successCount,
        clearedCount: result.clearedCount,
        total,
        errors,
      });

      if (errors.length === 0) {
        toast.success(
          `Imported ${result.successCount} row${result.successCount === 1 ? '' : 's'}.`,
        );
      } else {
        toast.warning(
          `Applied ${result.successCount} of ${total}. ${errors.length} row${
            errors.length === 1 ? '' : 's'
          } need attention.`,
        );
      }
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const header = ['Employee Code', 'Employee', 'Date', 'Status', 'Notes'];
    const examples = [
      ['APAR-001', 'Asha Verma', '2026-06-22', 'Work from home', ''],
      ['APAR-002', 'Rahul Nair', '2026-06-22', 'On leave', 'Casual leave'],
    ];
    const dataSheet = XLSX.utils.aoa_to_sheet([header, ...examples]);
    dataSheet['!cols'] = header.map((h) => ({ wch: Math.max(14, h.length + 2) }));

    const instructions = [
      ['Apar — Attendance Import Template'],
      [''],
      [
        'Fill the "Attendance" sheet — one row per (employee, date). Delete the example rows before uploading.',
      ],
      [''],
      ['Matching: each row needs at least one of Employee Code, Work Email, or exact Full Name.'],
      ['Employee Code is the most reliable. A duplicate name without a code is rejected.'],
      [''],
      ['Column', 'Required?', 'Notes'],
      ['Employee Code', 'One of these', 'e.g. APAR-001. Most reliable match.'],
      ['Employee', 'One of these', 'Full name. Used if no code/email.'],
      ['Work Email', 'Optional', 'Add this column to match by email.'],
      ['Date', 'Yes', 'YYYY-MM-DD (e.g. 2026-06-22). dd/mm/yyyy also accepted.'],
      [
        'Status',
        'Yes',
        `One of: ${ACCEPTED_STATUSES.join(', ')}. WFH is accepted for Work from home.`,
      ],
      ['Notes', 'Optional', 'Free text, up to 2000 characters.'],
      [''],
      ['Defaults: a status equal to the default for that day (present on weekdays,'],
      ['weekly-off on Sundays) stores nothing and clears any earlier override.'],
      ['Only the (employee, date) pairs in this file are touched — other days are untouched.'],
    ];
    const infoSheet = XLSX.utils.aoa_to_sheet(instructions);
    infoSheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 64 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Attendance');
    XLSX.utils.book_append_sheet(wb, infoSheet, 'Instructions');
    XLSX.writeFile(wb, 'apar-attendance-template.xlsx');
  };

  const handleOpenChange = (v: boolean) => {
    if (busy) return;
    setOpen(v);
    if (!v) reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className="btn" title="Import attendance from CSV or Excel">
          Import
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Import attendance from Excel</DialogTitle>
          <DialogDescription>
            Download the template, fill one row per employee per day, then upload it. Each row is
            matched to an employee by code, email, or name.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={downloadTemplate}
            type="button"
            className="justify-start"
          >
            <DownloadIcon className="mr-2 h-4 w-4" />
            Download Excel template (.xlsx)
          </Button>

          {outcome ? (
            <ImportResult outcome={outcome} />
          ) : (
            <div className="flex w-full items-center justify-center">
              <label
                htmlFor="attendance-dropzone-file"
                className="hover:bg-muted/50 flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {file ? (
                    <>
                      <FileIcon className="text-muted-foreground mb-2 h-8 w-8" />
                      <p className="text-sm font-semibold">{file.name}</p>
                    </>
                  ) : (
                    <>
                      <UploadIcon className="text-muted-foreground mb-2 h-8 w-8" />
                      <p className="text-muted-foreground text-sm">
                        <span className="font-semibold">Click to upload</span> your filled file
                      </p>
                      <p className="text-muted-foreground text-xs">.xlsx, .xls or .csv</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  id="attendance-dropzone-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>
          )}

          {error && (
            <div className="border-destructive/50 bg-destructive/10 text-destructive flex items-center gap-2 rounded-md border p-3 text-sm">
              <AlertCircleIcon className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            {outcome ? 'Close' : 'Cancel'}
          </Button>
          {!outcome && (
            <Button onClick={handleImport} disabled={!file || busy}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportResult({ outcome }: { outcome: ImportOutcome }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2Icon className="h-4 w-4 shrink-0" />
        <span>
          Applied <strong>{outcome.successCount}</strong> of {outcome.total} row
          {outcome.total === 1 ? '' : 's'}
          {outcome.clearedCount > 0 ? ` · ${outcome.clearedCount} reverted to default` : ''}.
        </span>
      </div>
      {outcome.errors.length > 0 && (
        <div className="border-destructive/40 bg-destructive/5 max-h-40 space-y-1 overflow-auto rounded-md border p-3">
          <p className="text-destructive font-medium">
            {outcome.errors.length} row{outcome.errors.length === 1 ? '' : 's'} skipped:
          </p>
          <ul className="text-muted-foreground list-inside list-disc space-y-0.5">
            {outcome.errors.map((e, i) => (
              <li key={`${e.row}-${i}`}>
                <span className="text-foreground">{e.label || `Row ${e.row}`}</span>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function firstHeaderIndex(headers: readonly string[], names: readonly string[]): number {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}
