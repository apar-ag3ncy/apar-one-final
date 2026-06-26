'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { UploadIcon, AlertCircleIcon, FileIcon, DownloadIcon, CheckCircle2Icon } from 'lucide-react';
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
import { importEmployees } from '@/lib/server/entities/employees';
import type { CreateEmployeeInput } from '@/lib/server/entities/employees';

/**
 * Bulk-import employees from an Excel (.xlsx/.xls) or CSV file.
 *
 * The user downloads a ready-made Excel template (header row + worked
 * examples + an Instructions sheet listing the accepted values), fills it
 * in, and uploads it. Every row is mapped to a `CreateEmployeeInput` and
 * created through the same server action / validation as the New-employee
 * wizard, so the books-level rules (unique work email, PAN format, etc.)
 * still apply per row.
 */

type ColumnSpec = {
  /** Human-friendly header shown in the template. */
  label: string;
  /** Accepted header aliases (normalised) when reading an uploaded file. */
  aliases: string[];
  required?: boolean;
};

// Order here = column order in the downloaded template.
const COLUMNS = {
  fullName: {
    label: 'Full Name',
    aliases: ['full_name', 'name', 'fullname', 'employee_name', 'employee'],
    required: true,
  },
  workEmail: {
    label: 'Work Email',
    aliases: ['work_email', 'email', 'workemail', 'email_id', 'official_email'],
  },
  personalEmail: {
    label: 'Personal Email',
    aliases: ['personal_email', 'personalemail', 'private_email'],
  },
  phone: { label: 'Phone', aliases: ['phone', 'mobile', 'contact', 'phone_number', 'mobile_number'] },
  designation: { label: 'Designation', aliases: ['designation', 'title', 'role', 'job_title'] },
  department: { label: 'Department', aliases: ['department', 'dept', 'team'] },
  employmentType: {
    label: 'Employment Type',
    aliases: ['employment_type', 'type', 'employment', 'emp_type'],
  },
  status: { label: 'Status', aliases: ['status'] },
  joinedOn: {
    label: 'Joining Date',
    aliases: ['joining_date', 'joined_on', 'date_of_joining', 'doj', 'join_date', 'joined'],
  },
  noticePeriodDays: {
    label: 'Notice Period',
    aliases: ['notice_period', 'notice_period_days', 'notice', 'notice_days'],
  },
  pan: { label: 'PAN', aliases: ['pan', 'pan_number', 'pan_no'] },
  registeredAddress: {
    label: 'Registered Address',
    aliases: ['registered_address', 'address', 'home_address', 'residential_address'],
  },
} satisfies Record<string, ColumnSpec>;

type ColumnKey = keyof typeof COLUMNS;

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant'] as const;
const STATUSES = ['prospective', 'active', 'on_leave', 'notice', 'separated'] as const;

type ImportOutcome = {
  successCount: number;
  errors: { index: number; name: string; message: string }[];
  total: number;
};

export function ImportEmployeesDialog({ onImported }: { onImported?: () => void } = {}) {
  const router = useRouter();
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
      const sheetName =
        wb.SheetNames.find((n) => /employee/i.test(n)) ?? wb.SheetNames[0];
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
        throw new Error('The file has no data rows — add at least one employee under the headers.');
      }

      const headers = (aoa[0] as unknown[]).map((h) => normalizeHeader(String(h ?? '')));
      const colIndex = {} as Record<ColumnKey, number>;
      for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
        colIndex[key] = firstHeaderIndex(headers, COLUMNS[key].aliases);
      }
      if (colIndex.fullName === -1) {
        throw new Error(
          'Could not find a "Full Name" column. Download the template and keep the header row.',
        );
      }

      const cell = (row: unknown[], key: ColumnKey): string => {
        const idx = colIndex[key];
        if (idx === -1) return '';
        return String(row[idx] ?? '').trim();
      };

      const inputs: CreateEmployeeInput[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const row = aoa[i] as unknown[];
        const fullName = cell(row, 'fullName');
        if (!fullName) continue; // skip blank rows
        inputs.push({
          fullName,
          workEmail: cell(row, 'workEmail') || undefined,
          personalEmail: cell(row, 'personalEmail') || undefined,
          phone: cell(row, 'phone') || undefined,
          designation: cell(row, 'designation') || undefined,
          department: cell(row, 'department') || undefined,
          employmentType: normalizeEmploymentType(cell(row, 'employmentType')),
          status: normalizeStatus(cell(row, 'status')),
          joinedOn: toIsoDate(cell(row, 'joinedOn')),
          noticePeriodDays: cell(row, 'noticePeriodDays') || undefined,
          pan: cell(row, 'pan') || undefined,
          registeredAddress: cell(row, 'registeredAddress') || undefined,
        });
      }

      if (inputs.length === 0) {
        throw new Error('No rows with a Full Name were found.');
      }

      const result = await importEmployees(inputs);
      setOutcome({ ...result, total: inputs.length });
      if (result.errors.length === 0) {
        toast.success(`Imported ${result.successCount} employee${result.successCount === 1 ? '' : 's'}.`);
        router.refresh();
        onImported?.();
      } else {
        toast.warning(
          `Imported ${result.successCount} of ${inputs.length}. ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} need attention.`,
        );
        router.refresh();
        onImported?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const keys = Object.keys(COLUMNS) as ColumnKey[];
    const header = keys.map((k) => COLUMNS[k].label);
    const examples = [
      [
        'Asha Verma',
        'asha@apar.agency',
        'asha.verma@gmail.com',
        '+91 98200 11111',
        'Senior Designer',
        'Creative',
        'full_time',
        'active',
        '2026-04-01',
        '30 days',
        'ABCDE1234F',
        '12 MG Road, Mumbai 400001',
      ],
      [
        'Rahul Nair',
        'rahul@apar.agency',
        '',
        '+91 98200 22222',
        'Account Manager',
        'Strategy',
        'full_time',
        'active',
        '2026-05-15',
        '60 days',
        '',
        '',
      ],
    ];
    const dataSheet = XLSX.utils.aoa_to_sheet([header, ...examples]);
    dataSheet['!cols'] = header.map((h) => ({ wch: Math.max(14, h.length + 2) }));

    const instructions = [
      ['Apār — Employee Import Template'],
      [''],
      ['Fill the "Employees" sheet — one row per employee. Delete the two example rows before uploading.'],
      [''],
      ['Column', 'Required?', 'Notes'],
      ['Full Name', 'Yes', 'The only required field.'],
      ['Work Email', 'No', 'Must be unique across employees.'],
      ['Personal Email', 'No', ''],
      ['Phone', 'No', ''],
      ['Designation', 'No', ''],
      ['Department', 'No', 'Free text — new departments are created automatically.'],
      ['Employment Type', 'No', `One of: ${EMPLOYMENT_TYPES.join(', ')}. Defaults to full_time.`],
      ['Status', 'No', `One of: ${STATUSES.join(', ')}. Defaults to active.`],
      ['Joining Date', 'No', 'Format YYYY-MM-DD (e.g. 2026-04-01). Defaults to today if blank.'],
      ['Notice Period', 'No', 'Free text, e.g. "30 days".'],
      ['PAN', 'No', 'Format ABCDE1234F. Stored masked.'],
      ['Registered Address', 'No', 'Home / registered address.'],
    ];
    const infoSheet = XLSX.utils.aoa_to_sheet(instructions);
    infoSheet['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 60 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Employees');
    XLSX.utils.book_append_sheet(wb, infoSheet, 'Instructions');
    XLSX.writeFile(wb, 'apar-employees-template.xlsx');
  };

  const handleOpenChange = (v: boolean) => {
    if (busy) return;
    setOpen(v);
    if (!v) reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UploadIcon className="mr-2 h-4 w-4" />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Import employees from Excel</DialogTitle>
          <DialogDescription>
            Download the Excel template, fill one row per employee, then upload it here. Every row is
            created with the same validation as the New-employee form.
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
                htmlFor="dropzone-file"
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
                      <p className="text-muted-foreground text-xs">.xlsx, .xls or .csv (max 5 MB)</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  id="dropzone-file"
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
          Imported <strong>{outcome.successCount}</strong> of {outcome.total} row
          {outcome.total === 1 ? '' : 's'}.
        </span>
      </div>
      {outcome.errors.length > 0 && (
        <div className="border-destructive/40 bg-destructive/5 max-h-40 space-y-1 overflow-auto rounded-md border p-3">
          <p className="text-destructive font-medium">
            {outcome.errors.length} row{outcome.errors.length === 1 ? '' : 's'} skipped:
          </p>
          <ul className="text-muted-foreground list-inside list-disc space-y-0.5">
            {outcome.errors.map((e) => (
              <li key={e.index}>
                <span className="text-foreground">{e.name || `Row ${e.index + 2}`}</span>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function firstHeaderIndex(headers: readonly string[], names: readonly string[]): number {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

function normalizeEmploymentType(raw: string): CreateEmployeeInput['employmentType'] {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!v) return 'full_time';
  if (['full_time', 'fulltime', 'permanent', 'ft'].includes(v)) return 'full_time';
  if (['part_time', 'parttime', 'pt'].includes(v)) return 'part_time';
  if (['contract', 'contractor', 'contractual'].includes(v)) return 'contract';
  if (['intern', 'internship', 'trainee'].includes(v)) return 'intern';
  if (['consultant', 'consulting', 'freelance', 'freelancer'].includes(v)) return 'consultant';
  return 'full_time';
}

function normalizeStatus(raw: string): CreateEmployeeInput['status'] {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!v) return 'active';
  if ((STATUSES as readonly string[]).includes(v)) return v as CreateEmployeeInput['status'];
  if (['onleave', 'leave'].includes(v)) return 'on_leave';
  if (['exited', 'resigned', 'terminated'].includes(v)) return 'separated';
  return 'active';
}

/** Coerce a cell into a YYYY-MM-DD string; defaults to today when unparseable. */
function toIsoDate(raw: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const v = raw.trim();
  if (!v) return today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return today;
}
