'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { UploadIcon, AlertCircleIcon, FileIcon } from 'lucide-react';
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

export function ImportEmployeesDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    setError(null);
    if (selected) {
      if (!selected.name.endsWith('.csv')) {
        setError('Please upload a valid CSV file.');
        setFile(null);
        return;
      }
      setFile(selected);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setIsParsing(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCsv(text);
        
        // Basic CSV parsing
        if (rows.length < 2) {
          throw new Error('CSV is empty or missing headers.');
        }

        const headers = rows[0]!.map(normalizeHeader);
        const nameIdx = firstHeaderIndex(headers, ['name', 'full_name', 'fullname', 'employee_name']);
        const emailIdx = firstHeaderIndex(headers, ['email', 'work_email', 'workemail']);
        const designationIdx = headers.indexOf('designation');
        const departmentIdx = headers.indexOf('department');

        if (nameIdx === -1) {
          throw new Error('CSV must contain a name, full name, or employee name column.');
        }

        const inputs: CreateEmployeeInput[] = [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]!;
          // Skip empty rows
          if (row.length === 1 && !row[0]) continue;
          
          const fullName = row[nameIdx];
          if (!fullName) continue;

          inputs.push({
            fullName,
            workEmail: emailIdx > -1 && row[emailIdx] ? row[emailIdx] : undefined,
            designation: designationIdx > -1 && row[designationIdx] ? row[designationIdx] : undefined,
            department: departmentIdx > -1 && row[departmentIdx] ? row[departmentIdx] : undefined,
            employmentType: 'full_time',
            status: 'active',
            joinedOn: new Date().toISOString().slice(0, 10),
          });
        }

        if (inputs.length === 0) {
          throw new Error('No valid rows found to import.');
        }

        setIsParsing(false);
        setIsImporting(true);

        const result = await importEmployees(inputs);
        if (result.errors.length > 0) {
          setError(`Import completed with ${result.errors.length} errors. Success: ${result.successCount}. Check your CSV for duplicates or invalid data.`);
        } else {
          toast.success(`Successfully imported ${result.successCount} employees.`);
          setOpen(false);
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV.');
        setIsParsing(false);
      } finally {
        setIsImporting(false);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file.');
      setIsParsing(false);
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const csvContent = 'full_name,work_email,designation,department\nJohn Doe,john.doe@company.com,Software Engineer,Engineering\nJane Smith,jane.smith@company.com,Product Manager,Product\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'employees_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenChange = (v: boolean) => {
    if (!isImporting && !isParsing) {
      setOpen(v);
      if (!v) {
        setFile(null);
        setError(null);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UploadIcon className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import Employees</DialogTitle>
          <DialogDescription>
            Upload a CSV file containing employee details. Accepted name headers: &quot;name&quot;,
            &quot;full name&quot;, or &quot;employee name&quot;. Optional columns: &quot;email&quot;, &quot;designation&quot;,
            &quot;department&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="flex items-center justify-center w-full">
            <label
              htmlFor="dropzone-file"
              className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50"
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                {file ? (
                  <>
                    <FileIcon className="w-8 h-8 mb-2 text-muted-foreground" />
                    <p className="text-sm font-semibold">{file.name}</p>
                  </>
                ) : (
                  <>
                    <UploadIcon className="w-8 h-8 mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold">Click to upload</span>
                    </p>
                    <p className="text-xs text-muted-foreground">CSV (MAX. 5MB)</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                id="dropzone-file"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircleIcon className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between flex-row">
          <Button variant="ghost" size="sm" onClick={downloadTemplate} type="button" className="p-0 h-auto text-xs text-muted-foreground hover:text-foreground">
            Download CSV Template
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isParsing || isImporting}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={!file || isParsing || isImporting}>
              {isParsing ? 'Parsing...' : isImporting ? 'Importing...' : 'Import'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}
