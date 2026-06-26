import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Tax reference rates · Apar Dashboard' };

// TODO(backend): swap for getTaxReferenceRates() once A ships.
const RATES = [
  { code: 'GST_NIL', label: 'GST 0%', ratePct: 0, effectiveFrom: '2017-07-01' },
  { code: 'GST_5', label: 'GST 5%', ratePct: 5, effectiveFrom: '2017-07-01' },
  { code: 'GST_12', label: 'GST 12%', ratePct: 12, effectiveFrom: '2017-07-01' },
  { code: 'GST_18', label: 'GST 18%', ratePct: 18, effectiveFrom: '2017-07-01' },
  { code: 'GST_28', label: 'GST 28%', ratePct: 28, effectiveFrom: '2017-07-01' },
  { code: 'TDS_194C', label: 'TDS 194C — Contracts', ratePct: 2, effectiveFrom: '2024-04-01' },
  {
    code: 'TDS_194J',
    label: 'TDS 194J — Professional services',
    ratePct: 10,
    effectiveFrom: '2024-04-01',
  },
  { code: 'TDS_194I', label: 'TDS 194I — Rent', ratePct: 10, effectiveFrom: '2024-04-01' },
  { code: 'TDS_194H', label: 'TDS 194H — Commission', ratePct: 5, effectiveFrom: '2024-04-01' },
];

export default function TaxRatesPage() {
  return (
    <>
      <ProfileHeader
        title="Tax reference rates"
        subtitle="Captured rates used to label fields and verify document totals. Apar never computes tax — these are reference values only."
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active rates</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Code</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Effective from</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RATES.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.ratePct}%</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.effectiveFrom}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-muted-foreground mt-3 text-xs">
        CRUD lands once Backend ships `setTaxReferenceRate` with versioning by `effective_from`.
      </p>
    </>
  );
}
